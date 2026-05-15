/**
 * POST /api/brief/amendments/[id]/reject
 *
 * V1.x-B.3 — user rejects a proposed amendment. Sets status='rejected'.
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §5.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { rejectBriefAmendment } from '@/lib/brief/amendments'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  void req
  const { id: amendmentId } = await context.params
  if (!isUuid(amendmentId)) return apiError(400, 'invalid_uuid')

  const userClient = await createClient()
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const { data: amendment } = await userClient
    .from('brief_amendments')
    .select('id, status')
    .eq('id', amendmentId)
    .maybeSingle()
  if (!amendment) return apiError(404, 'amendment_not_found')
  if (amendment.status !== 'proposed') {
    return apiError(409, 'amendment_not_proposed', `Amendment status is ${amendment.status}`)
  }

  try {
    await rejectBriefAmendment(amendmentId, user.id)
    return NextResponse.json({ amendment_id: amendmentId, status: 'rejected' })
  } catch (e) {
    return apiError(500, 'reject_failed', e instanceof Error ? e.message : String(e))
  }
}
