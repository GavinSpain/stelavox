/**
 * Phase 7 — POST /api/exports/[id]/cancel
 *
 * UI sets cancellation_requested_at; runner checks between pipeline
 * stages and halts at next safe boundary (same Stop pattern as
 * agent_jobs from V1.x-B.2 / V1.x-D).
 *
 * Returns 200 even if the job is already terminal — cancel-of-completed
 * is a no-op, not an error.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ exportJobId: string }> }

export async function POST(_request: NextRequest, { params }: Context) {
  try {
    const { exportJobId } = await params
    if (!isValidUuid(exportJobId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // UPDATE only fires if the job is still in an active state.
    // RLS gates by organisation membership.
    await supabase
      .from('export_jobs')
      .update({ cancellation_requested_at: new Date().toISOString() })
      .eq('id', exportJobId)
      .in('status', ['queued', 'planning', 'rendering', 'assembling', 'uploading'])

    return NextResponse.json({ ok: true })
  } catch {
    return err.internal()
  }
}
