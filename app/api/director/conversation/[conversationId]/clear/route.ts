/**
 * POST /api/director/conversation/[conversationId]/clear
 *
 * Source: V1.x-A build checklist §3.5 T-5.4.
 *         Director Architecture v2.0 §12.5 (User-initiated Clear).
 *
 * Clears the conversation's rolling-window message buffer. The Brief
 * and the document are untouched — the Brief carries the durable load
 * (V2 doc §12.1). After this call, the conversation appears empty in
 * the DirectorPanel, but `get_brief_state` still returns the full Brief.
 *
 * Hard delete of conversation_messages rows for this conversation. Also
 * clears conversations.conversation_summary + summary_covers_through so
 * the next Director turn starts from a genuinely empty window (without
 * the legacy summarisation prefix from prior turns).
 *
 * Author-of-conversation gated (G-2).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import {
  apiError,
  assertConversationAuthor,
  isUuid,
} from '@/lib/director/route-helpers'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params

  if (!isUuid(conversationId)) return apiError(400, 'invalid_uuid')

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const service = createServiceRoleClient()

  // 1. Visibility check — does the conversation exist for the caller's org?
  const { data: convo, error: convoErr } = await userClient
    .from('conversations')
    .select('id, document_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (convoErr) return apiError(500, 'internal_error', convoErr.message)
  if (!convo) return apiError(404, 'conversation_not_found')

  // 2. Author-of-conversation gate (G-2).
  const denial = await assertConversationAuthor(service, conversationId, user.id)
  if (denial) return denial

  // 3. Delete messages + reset summary state. Service-role client because
  // hard delete on conversation_messages isn't admitted by the standard
  // org-member RLS (FOR ALL but no DELETE policy variant — defensive).
  const { error: delErr, count } = await service
    .from('conversation_messages')
    .delete({ count: 'exact' })
    .eq('conversation_id', conversationId)
  if (delErr) return apiError(500, 'internal_error', delErr.message)

  const { error: updErr } = await service
    .from('conversations')
    .update({
      conversation_summary: null,
      summary_covers_through: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
  if (updErr) return apiError(500, 'internal_error', updErr.message)

  return NextResponse.json({ cleared: count ?? 0 })
}
