/**
 * GET /api/brief/[briefId]
 *
 * Source: V1.x-A build checklist §3.5 T-5.1.
 *
 * RLS-gated read of the Brief state. Returns the §6.3 flattened payload.
 * Authenticated callers see only Briefs in their organisation; the
 * server Supabase client enforces this via the standard
 * "org_members_access_briefs" policy on the briefs table.
 *
 * 404 on not-found-or-not-visible. The route does not distinguish; this
 * is intentional to avoid leaking the existence of foreign-org Briefs.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { getBriefState } from '@/lib/brief/getBriefState'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ briefId: string }> },
): Promise<Response> {
  const { briefId } = await context.params

  if (!isUuid(briefId)) {
    return apiError(400, 'invalid_uuid')
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const payload = await getBriefState(supabase, briefId)
    if (!payload) return apiError(404, 'brief_not_found')
    return NextResponse.json(payload)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
