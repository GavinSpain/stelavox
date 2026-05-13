/**
 * POST /api/brief/proposals/approve
 *
 * Source: V1.x-A build checklist §3.5 T-5.2.
 *
 * Approves a Director-proposed <brief_proposal> artefact for a document
 * with an empty Brief. The proposal JSON arrives in the request body
 * (parsed from the conversation_messages content by the UI). The route
 * runs the structural validator and dispatches the apply_brief_proposal
 * RPC.
 *
 * H-08 discipline: the RPC is the only path that mutates briefs +
 * brief_stages + brief_amendments — the route delegates rather than
 * writing directly.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { ProposeBriefInputSchema, buildBriefProposal } from '@/lib/brief/proposalBuilder'
import { applyBriefProposal, RpcError } from '@/lib/brief/applyProposal'
import { createClient } from '@/lib/supabase/server'

const ApproveRequestSchema = z.object({
  brief_id: z.string().uuid(),
  proposal: ProposeBriefInputSchema,
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

  // Structural validation (cycles, dangling refs, preference shape).
  let validated
  try {
    validated = buildBriefProposal(parsed.data.proposal)
  } catch (e) {
    return apiError(400, 'invalid_proposal', e instanceof Error ? e.message : String(e))
  }

  try {
    const result = await applyBriefProposal(supabase, parsed.data.brief_id, validated)
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof RpcError) {
      const code = e.message.includes('brief_not_found')
        ? 404
        : e.message.includes('brief_already_populated')
          ? 409
          : e.message.includes('forbidden')
            ? 403
            : 400
      return apiError(code, e.message)
    }
    const msg = e instanceof Error ? e.message : 'internal_error'
    return apiError(500, 'internal_error', msg)
  }
}
