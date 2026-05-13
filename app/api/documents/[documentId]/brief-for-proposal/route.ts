/**
 * GET /api/documents/[documentId]/brief-for-proposal?goal_text=...
 *
 * V1.x-A.1 — given a proposal's goal_text, look up whether a Brief has
 * already been created from it on this document. Used by
 * BriefProposalCard to detect "this proposal has been approved" after a
 * page reload (the card's local React state doesn't survive).
 *
 * Matches by goal_text because V1.x-A.1 enforces one active Brief at a
 * time, and the Director generates unique goal_text per propose_brief
 * call. V1.x-B (multi-Brief) will replace this with a direct proposal→
 * brief linkage written at accept_brief time.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params
  if (!isUuid(documentId)) return apiError(400, 'invalid_uuid')

  const url = new URL(req.url)
  const goalText = url.searchParams.get('goal_text')
  if (!goalText || goalText.length === 0) {
    return apiError(400, 'missing_goal_text')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const { data: brief, error: briefErr } = await supabase
    .from('briefs')
    .select('id, status, current_stage_id, created_at, completed_at, cancelled_at')
    .eq('document_id', documentId)
    .eq('goal_text', goalText)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (briefErr) return apiError(500, 'internal_error', briefErr.message)
  if (!brief) return NextResponse.json({ brief: null })

  // Include current stage info if available.
  let currentStage: { order: number; title: string; status: string } | null = null
  if (brief.current_stage_id) {
    const { data: stage } = await supabase
      .from('brief_stages')
      .select('order, title, status')
      .eq('id', brief.current_stage_id)
      .maybeSingle()
    if (stage) {
      const s = stage as { order: number; title: string; status: string }
      currentStage = { order: s.order, title: s.title, status: s.status }
    }
  }

  return NextResponse.json({
    brief: {
      id: brief.id,
      status: brief.status,
      current_stage: currentStage,
    },
  })
}
