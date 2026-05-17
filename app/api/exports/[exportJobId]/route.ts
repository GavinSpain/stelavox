/**
 * Phase 7 — GET /api/exports/[id]
 *
 * Returns current state of an export job. Most consumers use Realtime
 * subscription instead; this route is a fallback for non-Realtime
 * environments + a debugging surface.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ exportJobId: string }> }

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { exportJobId } = await params
    if (!isValidUuid(exportJobId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { data } = await supabase
      .from('export_jobs')
      .select(
        `id, organisation_id, document_id, format, profile_id, status, progress,
         storage_path, signed_url, signed_url_expires_at, error_message,
         attempt_count, total_chapters, created_at, completed_at, last_active_at,
         cancellation_requested_at`,
      )
      .eq('id', exportJobId)
      .maybeSingle()

    if (!data) return err.notFound()

    return NextResponse.json({ export_job: data })
  } catch {
    return err.internal()
  }
}
