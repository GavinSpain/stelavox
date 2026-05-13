/**
 * POST /api/brief/[briefId]/cancel
 *
 * V1.x-A.1 — cancel a planned or active Brief. Releases the partial
 * unique index slot for a new active Brief.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { cancelBrief, BriefRpcError } from '@/lib/brief/rpcWrappers'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ briefId: string }> },
): Promise<Response> {
  const { briefId } = await context.params
  if (!isUuid(briefId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const brief = await cancelBrief(supabase, briefId)
    return NextResponse.json(brief)
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
