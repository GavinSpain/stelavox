/**
 * Phase 7 — POST /api/exports/[id]/retry
 *
 * Creates a new export_jobs row with the same config as the failed/
 * cancelled row, attempt_count incremented. Original row stays in
 * history for audit.
 */

import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { runExportJob } from '@/lib/export/runner'

interface Context { params: Promise<{ exportJobId: string }> }

export async function POST(_request: NextRequest, { params }: Context) {
  try {
    const { exportJobId } = await params
    if (!isValidUuid(exportJobId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Load the original row's config
    const { data: original } = await supabase
      .from('export_jobs')
      .select('organisation_id, document_id, format, profile_id, attempt_count')
      .eq('id', exportJobId)
      .maybeSingle()

    if (!original) return err.notFound()

    // Insert new row with attempt_count + 1
    const { data: newRow, error: insertErr } = await supabase
      .from('export_jobs')
      .insert({
        organisation_id: original.organisation_id,
        document_id: original.document_id,
        format: original.format,
        profile_id: original.profile_id,
        status: 'queued',
        progress: { phase: 'queued' },
        last_active_at: new Date().toISOString(),
        attempt_count: ((original.attempt_count as number | null) ?? 0) + 1,
      })
      .select('id')
      .single()

    if (insertErr || !newRow) return err.internal()

    const newJobId = newRow.id as string
    waitUntil(runExportJob(newJobId))

    return NextResponse.json({ export_job_id: newJobId }, { status: 202 })
  } catch {
    return err.internal()
  }
}
