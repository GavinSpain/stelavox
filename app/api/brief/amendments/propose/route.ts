/**
 * POST /api/brief/amendments/propose
 *
 * V1.x-B.3 — manual amendment-proposal entry point. Used by the UI when
 * a user proposes an amendment without going through the Director (V2
 * candidate flow; V1 surface is via the Director's propose_brief_amendment
 * tool which routes through the iteration-runner artefact path).
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §5.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { insertBriefAmendmentProposal } from '@/lib/brief/amendments'

const ProposeRequestSchema = z.object({
  brief_id: z.string().uuid(),
  amendment_type: z.enum([
    'goal_text',
    'preferences',
    'add_stage',
    'modify_pending_stage',
    'remove_pending_stage',
  ]),
  target_path: z.string().nullish(),
  before: z.record(z.string(), z.unknown()).nullish(),
  after: z.record(z.string(), z.unknown()),
  reason: z.string().min(1).max(1024),
})

export async function POST(req: NextRequest): Promise<Response> {
  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let body: unknown
  try { body = await req.json() } catch { return apiError(400, 'invalid_json') }

  const parsed = ProposeRequestSchema.safeParse(body)
  if (!parsed.success) return apiError(400, 'invalid_body', parsed.error.message)

  // RLS-gated read confirms the user can see the Brief.
  const { data: brief } = await userClient
    .from('briefs')
    .select('id, status')
    .eq('id', parsed.data.brief_id)
    .maybeSingle()
  if (!brief) return apiError(404, 'brief_not_found')
  if (brief.status !== 'active' && brief.status !== 'planned') {
    return apiError(409, 'brief_not_amendable', `Brief status is ${brief.status}`)
  }

  try {
    const { amendmentId } = await insertBriefAmendmentProposal({
      artefact: {
        brief_id: parsed.data.brief_id,
        amendment_type: parsed.data.amendment_type,
        target_path: parsed.data.target_path ?? null,
        before: (parsed.data.before ?? null) as Record<string, unknown> | null,
        after: parsed.data.after,
        reason: parsed.data.reason,
      },
      proposedByUserId: user.id,
    })
    return NextResponse.json({ amendment_id: amendmentId, status: 'proposed' })
  } catch (e) {
    return apiError(400, 'invalid_proposal', e instanceof Error ? e.message : String(e))
  }
}
