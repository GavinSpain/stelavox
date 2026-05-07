/**
 * POST /api/director/conversation/[conversationId]/messages — admin
 * append (replay / V2 import tooling).
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.4.
 * Build Checklist: T-12.4.
 *
 * Service-role-only in Phase 5b V1. The user-session client is rejected
 * with 403 not_admin. Reserved for future admin tooling — V2 conversation
 * import.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { ConversationMessageAppendSchema } from '@/lib/director/schemas'
import { apiError, isUuid } from '@/lib/director/route-helpers'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params
  if (!isUuid(conversationId)) return apiError(400, 'invalid_uuid')

  // Admin gate: this route is reserved for V2 import tooling. The Phase
  // 5b UI never calls it. We reject all callers in V1 — when admin
  // tooling lands the gate becomes a service-role + signed-token check.
  void req
  void ConversationMessageAppendSchema
  return apiError(
    403,
    'not_admin',
    'This endpoint is reserved for admin / replay tooling and is not exposed in V1.',
  )
}
