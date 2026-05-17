/**
 * Phase 7 — POST /api/exports
 *
 * Body: { document_id, format, profile_id? }
 *
 * Validates request, INSERTs export_jobs row at status='queued',
 * fires the runner via waitUntil (Vercel-aware async background),
 * returns 202 with the new export_job id immediately.
 *
 * Author opens Export modal → picks format + profile → clicks Export →
 * this route runs → modal closes → ExportProgressChip mounts and
 * subscribes via Realtime to track the job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { runExportJob } from '@/lib/export/runner'

const exportPostSchema = z.object({
  document_id: z.string().uuid(),
  format: z.enum(['docx', 'epub', 'json', 'outline']),
  profile_id: z.string().uuid().nullable().optional(),
}).strict()

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

    // Look up the document to get its organisation_id (RLS-gated).
    const { data: doc } = await supabase
      .from('documents')
      .select('id, organisation_id')
      .eq('id', parsed.data.document_id)
      .maybeSingle()

    if (!doc) return err.notFound()

    // Insert the export_jobs row at status='queued'.
    const { data: jobRow, error: insertErr } = await supabase
      .from('export_jobs')
      .insert({
        organisation_id: doc.organisation_id,
        document_id: parsed.data.document_id,
        format: parsed.data.format,
        profile_id: parsed.data.profile_id ?? null,
        status: 'queued',
        progress: { phase: 'queued' },
        last_active_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (insertErr || !jobRow) {
      return err.internal()
    }

    const exportJobId = jobRow.id as string

    // Fire the runner in the background. waitUntil keeps the function
    // alive past the HTTP response; runner is fully self-contained
    // (its own service-role client + all error handling).
    waitUntil(runExportJob(exportJobId))

    return NextResponse.json({ export_job_id: exportJobId }, { status: 202 })
  } catch {
    return err.internal()
  }
}
