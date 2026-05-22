/**
 * POST /api/scheduler/jobs/[jobId]/cancel
 *
 * Best-effort agent_job cancellation.
 *
 * Original V1.x-B.1.1 implementation updated only agent_jobs.status (the
 * legacy column). V1.x-B.2 introduced agent_jobs.queue_status as the
 * dispatcher's primary status column and a stop_requests table as the
 * runner's cooperative-abort channel. The runner's iteration loop gates
 * on stop_requests, not on agent_jobs.status — so the original cancel
 * marked the row 'cancelled' on the legacy column without actually
 * stopping a running iteration. 2026-05-17 testing surfaced this: a
 * SchedulerPanel cancel left the iteration heartbeating and the
 * conversation locked.
 *
 * This route now:
 *   1. Updates BOTH agent_jobs.status and queue_status to 'cancelled'.
 *   2. If the job is part of a director_turn, writes a stop_requests row
 *      so the runner's in-loop check fires; marks the turn cancelled;
 *      and marks any interim conversation_messages row 'interrupted' so
 *      the conversation_locked single-flight gate releases.
 *
 * Optional body: { reason?: string }.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

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

  // RLS-gated read confirms the caller can see this job + surfaces the
  // director_turn link so we can propagate the cancel.
  const { data: job } = await supabase
    .from('agent_jobs')
    .select('id, status, queue_status, director_turn_id, organisation_id')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return apiError(404, 'job_not_found')

  if (NON_CANCELLABLE.has(job.status) && NON_CANCELLABLE.has(job.queue_status)) {
    return apiError(409, 'invalid_status', `cannot cancel job in status "${job.status}/${job.queue_status}"`)
  }

  // Apollo Phase 3: delegate to orchestration. The DB trigger refuses
  // illegal transitions and auto-derive keeps legacy columns in sync.
  const { transitionAgentJob } = await import('@/lib/orchestration')
  const cancelResult = await transitionAgentJob(
    supabase,
    jobId,
    'cancel_or_cascade',
    'cancelled',
    { errorMessage: reason !== null ? `cancelled_by_user: ${reason}` : undefined },
  )
  if (!cancelResult.ok && cancelResult.error === 'illegal_transition') {
    // The row was already terminal — handled gracefully (idempotent).
  } else if (!cancelResult.ok) {
    return apiError(500, 'cancel_update_failed', cancelResult.message ?? cancelResult.error ?? 'unknown')
  }

  // Director-turn propagation. The runner can't see a cancelled agent_job
  // directly — it watches stop_requests by director_turn_id. Without
  // these three writes the in-flight LLM call keeps running and the
  // conversation stays locked because of the interim assistant row.
  if (job.director_turn_id) {
    const svc = createServiceRoleClient()

    // 1. stop_requests row — runner's cooperative-abort signal.
    await svc.from('stop_requests').insert({
      requested_by: user.id,
      target_kind: 'director_turn',
      target_id: job.director_turn_id,
      reason: reason ?? 'cancelled_via_scheduler',
      organisation_id: job.organisation_id,
    })

    // 2. Mark the turn cancelled if not already terminal. Apollo Phase 3:
    // delegate to orchestration. Closes G-09 — pre-fix this set
    // turn_state but left director_turns.status='in_progress', so the
    // conversation-lock check rejected new messages indefinitely.
    const { transitionDirectorTurn } = await import('@/lib/orchestration')
    await transitionDirectorTurn(svc, job.director_turn_id, 'mark_turn_cancelled', 'cancelled')

    // 3. Release the conversation single-flight gate by closing the
    // interim assistant message. The turn id isn't directly on
    // conversation_messages, so we resolve via the turn's conversation.
    const { data: turn } = await svc
      .from('director_turns')
      .select('conversation_id')
      .eq('id', job.director_turn_id)
      .maybeSingle()
    if (turn?.conversation_id) {
      await svc
        .from('conversation_messages')
        .update({ turn_state: 'interrupted' })
        .eq('conversation_id', turn.conversation_id)
        .eq('turn_state', 'interim')
    }
  }

  // Re-read to surface the resolved status (could differ if a worker raced).
  const { data: updated } = await supabase
    .from('agent_jobs')
    .select('id, status, queue_status, completed_at, error_message')
    .eq('id', jobId)
    .maybeSingle()

  return NextResponse.json({
    job_id: jobId,
    final_status: updated?.status ?? 'cancelled',
    final_queue_status: updated?.queue_status ?? 'cancelled',
    completed_at: updated?.completed_at ?? null,
  })
}
