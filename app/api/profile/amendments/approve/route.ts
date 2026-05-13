/**
 * POST /api/profile/amendments/approve
 *
 * V1.x-A.1 — applies a Director-proposed <profile_amendment_proposal>.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import {
  ProposeProfileAmendmentInputSchema,
  buildProfileAmendmentProposal,
} from '@/lib/profile/proposalBuilder'
import { applyProfileAmendment, RpcError } from '@/lib/profile/applyAmendment'
import { createClient } from '@/lib/supabase/server'

const ApproveRequestSchema = z.object({
  profile_id: z.string().uuid(),
  amendment: ProposeProfileAmendmentInputSchema,
})

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let body: unknown
  try { body = await req.json() } catch { return apiError(400, 'invalid_json') }

  const parsed = ApproveRequestSchema.safeParse(body)
  if (!parsed.success) return apiError(400, 'invalid_body', parsed.error.message)
  if (!isUuid(parsed.data.profile_id)) return apiError(400, 'invalid_uuid')

  let validated
  try {
    validated = buildProfileAmendmentProposal(parsed.data.amendment)
  } catch (e: unknown) {
    return apiError(400, 'invalid_amendment', e instanceof Error ? e.message : String(e))
  }

  try {
    const result = await applyProfileAmendment(supabase, parsed.data.profile_id, validated)
    return NextResponse.json(result)
  } catch (e: unknown) {
    if (e instanceof RpcError) {
      const code = e.message.includes('profile_not_found') ? 404
        : e.message.includes('forbidden') ? 403
        : 400
      return apiError(code, e.message)
    }
    const msg = e instanceof Error ? e.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
