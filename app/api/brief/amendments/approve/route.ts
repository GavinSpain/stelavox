/**
 * POST /api/brief/amendments/approve
 *
 * Source: V1.x-A build checklist §3.5 T-5.3.
 *
 * Approves a Director-proposed <brief_amendment_proposal> artefact for
 * a populated Brief. V1.x-A supports preferences-* and update_goal_text
 * amendment types only — stage roadmap amendments raise
 * not_implemented_in_v1xa from the RPC.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import {
  ProposeBriefAmendmentInputSchema,
  buildBriefAmendmentProposal,
} from '@/lib/brief/proposalBuilder'
import { applyBriefAmendment } from '@/lib/brief/applyAmendment'
import { RpcError } from '@/lib/brief/applyProposal'
import { createClient } from '@/lib/supabase/server'

const ApproveRequestSchema = z.object({
  brief_id: z.string().uuid(),
  amendment: ProposeBriefAmendmentInputSchema,
})

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return apiError(400, 'invalid_json')
  }

  const parsed = ApproveRequestSchema.safeParse(body)
  if (!parsed.success) {
    return apiError(400, 'invalid_body', parsed.error.message)
  }

  if (!isUuid(parsed.data.brief_id)) {
    return apiError(400, 'invalid_uuid')
  }

  let validated
  try {
    validated = buildBriefAmendmentProposal(parsed.data.amendment)
  } catch (e) {
    return apiError(400, 'invalid_amendment', e instanceof Error ? e.message : String(e))
  }

  try {
    const result = await applyBriefAmendment(supabase, parsed.data.brief_id, validated)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof RpcError) {
      const code = e.message.includes('brief_not_found')
        ? 404
        : e.message.includes('brief_empty')
          ? 409
          : e.message.includes('not_implemented_in_v1xa')
            ? 501
            : e.message.includes('forbidden')
              ? 403
              : 400
      return apiError(code, e.message)
    }
    const msg = e instanceof Error ? e.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
