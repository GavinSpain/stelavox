/**
 * GET /api/profile/[profileId]
 *
 * V1.x-A.1 — RLS-gated read of the Project Profile.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { getProjectProfile } from '@/lib/profile/getProjectProfile'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ profileId: string }> },
): Promise<Response> {
  const { profileId } = await context.params
  if (!isUuid(profileId)) return apiError(400, 'invalid_uuid')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const payload = await getProjectProfile(supabase, profileId)
    if (!payload) return apiError(404, 'profile_not_found')
    return NextResponse.json(payload)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
