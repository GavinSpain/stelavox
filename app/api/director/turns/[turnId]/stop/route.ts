/**
 * POST /api/director/turns/[turnId]/stop
 *
 * V1.x-B.2.1 — Stop a Director turn. Inserts a stop_request row and
 * marks any queued descendant agent_jobs cancelled. In-flight
 * iterations check the stop predicate before each LLM call and abort
 * cooperatively.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.5
 *         + Director Architecture v2.0 §13 (Stop semantics).
 *
 * Request body (optional): { reason?: string }
 * Response: { stop_request_id, target_kind: 'director_turn', target_id, cascade }
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { insertStopRequest } from '@/lib/scheduler/stopRequests'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  const { turnId } = await context.params
  if (!isUuid(turnId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // RLS-gated read confirms caller can see this turn (and gives us the
  // organisation_id via conversations join).
  const { data: turn } = await supabase
    .from('director_turns')
    .select('id, status, conversation_id, conversations!inner(organisation_id)')
    .eq('id', turnId)
    .maybeSingle()
  if (!turn) return apiError(404, 'turn_not_found')

  if (turn.status !== 'in_progress') {
    return apiError(409, 'invalid_status', `cannot stop turn in status "${turn.status}"`)
  }

  const conversations = turn.conversations as unknown as { organisation_id: string } | null
  const organisationId = conversations?.organisation_id
  if (!organisationId) {
    return apiError(500, 'org_not_resolved')
  }

  // Optional reason field.
  let reason: string | undefined
  try {
    const body = await req.json().catch(() => ({}))
    if (
      body &&
      typeof body === 'object' &&
      typeof (body as { reason?: unknown }).reason === 'string'
    ) {
      reason = (body as { reason: string }).reason
    }
  } catch {
    /* empty body is fine */
  }

  let result
  try {
    result = await insertStopRequest({
      organisationId,
      requestedByUserId: user.id,
      targetKind: 'director_turn',
      targetId: turnId,
      reason,
    })
  } catch (err) {
    return apiError(500, 'stop_insert_failed', err instanceof Error ? err.message : String(err))
  }

  // Mark the turn cancelled. Iteration agent_jobs that the runner
  // discovers as in-flight will set queue_status='cancelled' on its own
  // cooperative-abort path; queued ones were marked by insertStopRequest.
  await supabase
    .from('director_turns')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', turnId)
    .eq('status', 'in_progress')

  return NextResponse.json({
    stop_request_id: result.stopRequestId,
    target_kind: 'director_turn',
    target_id: turnId,
    cascade: result.cascade,
  })
}
