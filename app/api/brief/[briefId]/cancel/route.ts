/**
 * POST /api/brief/[briefId]/cancel
 *
 * V1.x-B.1.1 — cancel a planned, queued, or active Brief. Cascade-cancels
 * non-terminal stages, emits cancel_cascade system event, auto-promotes
 * the next queued Brief if the cancelled one was active. Returns the
 * cascade summary jsonb.
 *
 * Optional body: { reason?: string } — logged in the system event payload
 * (default 'user_cancelled').
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { cancelBrief, BriefRpcError } from '@/lib/brief/rpcWrappers'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ briefId: string }> },
): Promise<Response> {
  const { briefId } = await context.params
  if (!isUuid(briefId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let reason = 'user_cancelled'
  try {
    const body = await req.json().catch(() => ({}))
    if (body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string') {
      reason = (body as { reason: string }).reason
    }
  } catch {
    // Empty body is fine — keep the default reason.
  }

  try {
    const result = await cancelBrief(supabase, briefId, reason)
    return NextResponse.json(result)
  } catch (e: unknown) {
    if (e instanceof BriefRpcError) {
      const code = e.message.includes('brief_not_found') ? 404
        : e.message.includes('invalid_status') ? 409
        : e.message.includes('forbidden') ? 403
        : 400
      return apiError(code, e.message)
    }
    const msg = e instanceof Error ? e.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
