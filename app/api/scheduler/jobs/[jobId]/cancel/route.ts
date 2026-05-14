/**
 * POST /api/scheduler/jobs/[jobId]/cancel
 *
 * V1.x-B.1.1 — best-effort agent_job cancellation. Sets status='cancelled'
 * via UPDATE — wins on row lock. An in-flight worker may still write
 * its 'completed' or 'failed' result; the next read sees whichever
 * UPDATE landed last. Documented as best-effort in the SchedulerPanel
 * UI.
 *
 * Stop (resumable halt) is deferred to session 3 alongside lib/scheduler/
 * dispatcher — it requires a 'paused' status enum extension + a tick
 * body that respects it.
 *
 * Optional body: { reason?: string }.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

const NON_CANCELLABLE = new Set(['completed', 'accepted', 'cancelled', 'failed', 'dismissed'])

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params
  if (!isUuid(jobId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let reason: string | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
      reason = (body as { reason: string }).reason
    }
  } catch {
    /* empty body is fine */
  }

  // RLS-gated read confirms the caller can see this job.
  const { data: job } = await supabase
    .from('agent_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return apiError(404, 'job_not_found')

  if (NON_CANCELLABLE.has(job.status)) {
    return apiError(409, 'invalid_status', `cannot cancel job in status "${job.status}"`)
  }

  const update: Record<string, unknown> = {
    status: 'cancelled',
    completed_at: new Date().toISOString(),
  }
  if (reason !== null) {
    update.error_message = `cancelled_by_user: ${reason}`
  }

  const { error } = await supabase
    .from('agent_jobs')
    .update(update)
    .eq('id', jobId)
    .in('status', ['pending', 'running'])  // best-effort: skip if a terminal write raced us

  if (error) return apiError(500, 'cancel_update_failed', error.message)

  // Re-read to surface the resolved status (could differ if a worker raced).
  const { data: updated } = await supabase
    .from('agent_jobs')
    .select('id, status, completed_at, error_message')
    .eq('id', jobId)
    .maybeSingle()

  return NextResponse.json({
    job_id: jobId,
    final_status: updated?.status ?? 'cancelled',
    completed_at: updated?.completed_at ?? null,
  })
}
