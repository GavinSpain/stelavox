/**
 * Phase 7 — POST /api/exports  (DR-042: per-book exports)
 *
 * Body: { document_id, format, profile_id?, book_node_ids?: string[] }
 *
 * Whole-document export (book_node_ids absent / empty): one job, returns
 * { export_job_id }. Per-book export (book_node_ids present — DOCX/EPUB on
 * a Series document): one job per selected Book node, each scoped to that
 * book's subtree via export_jobs.root_node_id, returns { export_job_ids }.
 *
 * Each job INSERTs at status='queued' and the runner fires via waitUntil.
 */

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { runExportJob } from '@/lib/export/runner'
import type { ExportFormat } from '@/lib/export/types'

const exportPostSchema = z.object({
  document_id: z.string().uuid(),
  format: z.enum(['docx', 'epub', 'markdown', 'outline']),
  profile_id: z.string().uuid().nullable().optional(),
  // DR-042 — Book node ids for a per-book export. When present, one job
  // per id (each scoped to that book's subtree). Whole-document otherwise.
  book_node_ids: z.array(z.string().uuid()).max(200).optional(),
}).strict()

const EXT: Record<ExportFormat, string> = {
  docx: 'docx', epub: 'epub', markdown: 'md', outline: 'md',
}

/** Strip path-/filesystem-unsafe characters from a filename component. */
function sanitise(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'Untitled'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = exportPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      return err.invalidJson()
    }

    const { document_id, format, profile_id, book_node_ids } = parsed.data

    // Look up the document (RLS-gated) for organisation_id + name.
    const { data: doc } = await supabase
      .from('documents')
      .select('id, organisation_id, name')
      .eq('id', document_id)
      .maybeSingle()
    if (!doc) return err.notFound()

    const seriesName = sanitise((doc.name as string | null) ?? 'Untitled')
    const ext = EXT[format]
    const nowIso = new Date().toISOString()

    function baseJob(rootNodeId: string | null, fileName: string) {
      return {
        organisation_id: doc!.organisation_id,
        document_id,
        format,
        profile_id: profile_id ?? null,
        root_node_id: rootNodeId,
        file_name: fileName,
        status: 'queued' as const,
        progress: { phase: 'queued' as const },
        last_active_at: nowIso,
      }
    }

    // ── Per-book export ──────────────────────────────────────────────
    if (book_node_ids && book_node_ids.length > 0) {
      // Validate the ids are structural nodes in THIS document (RLS-gated).
      const { data: books } = await supabase
        .from('nodes')
        .select('id, name, "order"')
        .eq('document_id', document_id)
        .eq('node_category', 'structural')
        .in('id', book_node_ids)
      if (!books || books.length === 0) return err.notFound()

      const ordered = [...books].sort(
        (a, b) => ((a.order as number) ?? 0) - ((b.order as number) ?? 0),
      )
      const rows = ordered.map((b) => {
        const nn = String(((b.order as number) ?? 0)).padStart(2, '0')
        const bookName = sanitise((b.name as string | null) ?? `Book ${nn}`)
        const fileName = `${seriesName} — ${nn} ${bookName}.${ext}`
        return baseJob(b.id as string, fileName)
      })

      const { data: inserted, error: insertErr } = await supabase
        .from('export_jobs').insert(rows).select('id')
      if (insertErr || !inserted) return err.internal()

      const ids = inserted.map((r) => r.id as string)
      for (const id of ids) waitUntil(runExportJob(id))
      return NextResponse.json({ export_job_ids: ids }, { status: 202 })
    }

    // ── Whole-document export ────────────────────────────────────────
    const { data: jobRow, error: insertErr } = await supabase
      .from('export_jobs')
      .insert(baseJob(null, `${seriesName}.${ext}`))
      .select('id')
      .single()
    if (insertErr || !jobRow) return err.internal()

    const exportJobId = jobRow.id as string
    waitUntil(runExportJob(exportJobId))
    return NextResponse.json({ export_job_id: exportJobId }, { status: 202 })
  } catch {
    return err.internal()
  }
}
