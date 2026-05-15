/**
 * POST /api/scheduler/stop
 *
 * V1.x-B.2.1 — Generic Stop endpoint accepting target_kind +
 * target_id. Used by SchedulerPanel rows to halt workflows or briefs
 * (the per-Director-turn endpoint at /api/director/turns/[turnId]/stop
 * handles the dedicated UI).
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.5
 *         + Director Architecture v2.0 §13 (Stop semantics).
 *
 * Request body: { target_kind: 'director_turn' | 'workflow' | 'brief',
 *                 target_id: uuid, reason?: string }
 * Response: { stop_request_id, target_kind, target_id, cascade }
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { insertStopRequest } from '@/lib/scheduler/stopRequests'

const StopRequestBodySchema = z.object({
  target_kind: z.enum(['director_turn', 'workflow', 'brief']),
  target_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
})

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const raw = await req.json().catch(() => null)
  const parsed = StopRequestBodySchema.safeParse(raw)
  if (!parsed.success) {
    return apiError(400, 'invalid_body', parsed.error.message)
  }
  const body = parsed.data

  // Resolve the organisation_id via the target. RLS on the target table
  // also gates whether the user is allowed to see the row.
  let organisationId: string | null = null

  if (body.target_kind === 'director_turn') {
    const { data: turn } = await supabase
      .from('director_turns')
      .select('id, conversations!inner(organisation_id)')
      .eq('id', body.target_id)
      .maybeSingle()
    if (!turn) return apiError(404, 'target_not_found')
    organisationId = (turn.conversations as unknown as { organisation_id: string } | null)?.organisation_id ?? null
  } else if (body.target_kind === 'workflow') {
    const { data: wf } = await supabase
      .from('workflows')
      .select('id, organisation_id')
      .eq('id', body.target_id)
      .maybeSingle()
    if (!wf) return apiError(404, 'target_not_found')
    organisationId = wf.organisation_id as string | null
  } else {
    // brief
    const { data: brief } = await supabase
      .from('briefs')
      .select('id, organisation_id')
      .eq('id', body.target_id)
      .maybeSingle()
    if (!brief) return apiError(404, 'target_not_found')
    organisationId = brief.organisation_id as string | null
  }

  if (!organisationId) return apiError(500, 'org_not_resolved')

  let result
  try {
    result = await insertStopRequest({
      organisationId,
      requestedByUserId: user.id,
      targetKind: body.target_kind,
      targetId: body.target_id,
      reason: body.reason,
    })
  } catch (err) {
    return apiError(500, 'stop_insert_failed', err instanceof Error ? err.message : String(err))
  }

  return NextResponse.json({
    stop_request_id: result.stopRequestId,
    target_kind: body.target_kind,
    target_id: body.target_id,
    cascade: result.cascade,
  })
}
