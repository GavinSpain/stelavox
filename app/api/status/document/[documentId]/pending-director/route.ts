/**
 * GET /api/status/document/[documentId]/pending-director
 *
 * V1.x-B.1.1 — backing data for the ModeTabBar Director tab indicator.
 * Returns whether the current document has any pending Director
 * attention items (proposal cards in the conversation that haven't yet
 * been actioned).
 *
 * Detection:
 *   - propose_brief tool calls with proposal_artefact whose Brief id
 *     hasn't yet landed (Brief row absent → still in proposal stage).
 *     [V1.x-A.1 BriefProposalCard does the same lookup client-side.]
 *   - propose_profile_amendment tool calls with proposal_artefact
 *     whose corresponding profile_amendments audit row hasn't landed.
 *   - cancel_brief tool calls with proposal_artefact whose target
 *     Brief is still in a non-terminal state.
 *
 * For B.1.1 substrate work the simpler heuristic is "any
 * proposal_artefact in the document's conversation tool_calls audit"
 * — if the user already approved, the artefact is still there for
 * audit, so this overstates pending. Refinement deferred to session 3.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params
  if (!isUuid(documentId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // 1. Find the document's most recent conversation.
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!conv) {
    return NextResponse.json({ has_pending: false, types: [] })
  }

  // 2. Pull recent assistant messages with proposal_artefact in
  // tool_calls. Limit window to last 50 messages — older proposals
  // are noise for the badge surface.
  const { data: messages } = await supabase
    .from('conversation_messages')
    .select('id, tool_calls')
    .eq('conversation_id', conv.id)
    .eq('role', 'assistant')
    .order('sequence', { ascending: false })
    .limit(50)

  const types = new Set<string>()
  const activeBriefIds: string[] = []
  const proposedBriefGoals: string[] = []
  const proposedAmendmentTimes: string[] = []

  for (const m of messages ?? []) {
    const toolCalls = Array.isArray(m.tool_calls) ? m.tool_calls : []
    for (const raw of toolCalls) {
      if (!raw || typeof raw !== 'object') continue
      const entry = raw as { name?: string; proposal_artefact?: unknown; arguments?: Record<string, unknown>; executed_at?: string }
      if (entry.proposal_artefact === undefined) continue

      if (entry.name === 'propose_brief') {
        const a = entry.proposal_artefact as { goal_text?: string }
        if (typeof a.goal_text === 'string') proposedBriefGoals.push(a.goal_text)
      } else if (entry.name === 'propose_profile_amendment') {
        if (entry.executed_at) proposedAmendmentTimes.push(entry.executed_at)
      } else if (entry.name === 'cancel_brief') {
        const a = entry.proposal_artefact as { brief_id?: string }
        if (typeof a.brief_id === 'string') activeBriefIds.push(a.brief_id)
      }
    }
  }

  // Brief proposals: pending iff no Brief on this document matches the goal_text.
  if (proposedBriefGoals.length > 0) {
    const { data: existingBriefs } = await supabase
      .from('briefs')
      .select('goal_text')
      .eq('document_id', documentId)
      .in('goal_text', proposedBriefGoals)
    const existingSet = new Set((existingBriefs ?? []).map((b) => b.goal_text))
    if (proposedBriefGoals.some((g) => !existingSet.has(g))) {
      types.add('brief_proposal')
    }
  }

  // Cancel proposals: pending iff target Brief still in non-terminal status.
  if (activeBriefIds.length > 0) {
    const { data: targetBriefs } = await supabase
      .from('briefs')
      .select('id, status')
      .in('id', activeBriefIds)
    const stillCancellable = (targetBriefs ?? []).some(
      (b) => b.status === 'planned' || b.status === 'queued' || b.status === 'active',
    )
    if (stillCancellable) types.add('brief_cancellation_proposal')
  }

  // Profile amendments: B.1.1 heuristic — any in the recent window counts as
  // potentially pending. Refinement (cross-check against profile_amendments
  // audit table) deferred to session 3.
  if (proposedAmendmentTimes.length > 0) {
    types.add('profile_amendment_proposal')
  }

  return NextResponse.json({
    has_pending: types.size > 0,
    types: Array.from(types),
  })
}
