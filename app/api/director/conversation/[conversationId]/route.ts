/**
 * GET /api/director/conversation/[conversationId]
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.2.
 * Build Checklist: T-12.2.
 *
 * Returns the conversation row + paginated messages (cursor-style).
 * Default 20, max 50. Cursor is the last seen sequence; results are
 * messages with sequence < cursor.sequence.
 *
 * Excludes interim/interrupted assistant rows from the public listing
 * (interim is server-bookkeeping; interrupted is surfaced via the
 * resume button only).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params
  if (!isUuid(conversationId)) return apiError(400, 'invalid_uuid')

  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // RLS visibility check.
  const { data: conv } = await userClient
    .from('conversations')
    .select(
      'id, document_id, organisation_id, conversation_summary, summary_covers_through, created_at, updated_at',
    )
    .eq('id', conversationId)
    .maybeSingle()
  if (!conv) return apiError(404, 'conversation_not_found')

  // Pagination.
  const limit = clampInt(
    parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10),
    1,
    50,
    20,
  )
  const cursorRaw = req.nextUrl.searchParams.get('cursor')

  const service = createServiceRoleClient()

  // Resolve cursor → sequence.
  let cursorSequence: number | null = null
  if (cursorRaw) {
    if (!isUuid(cursorRaw)) return apiError(400, 'invalid_cursor')
    const { data: cursorRow } = await service
      .from('conversation_messages')
      .select('sequence')
      .eq('id', cursorRaw)
      .maybeSingle()
    if (!cursorRow) return apiError(400, 'invalid_cursor')
    cursorSequence = cursorRow.sequence
  }

  let q = service
    .from('conversation_messages')
    .select(
      'id, role, content, sequence, tool_calls, workflow_id, turn_state, created_at, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_usd',
    )
    .eq('conversation_id', conversationId)
    .in('turn_state', ['final'])
    .order('sequence', { ascending: false })
    .limit(limit + 1)

  if (cursorSequence != null) q = q.lt('sequence', cursorSequence)

  const { data: messages, error } = await q
  if (error) return apiError(500, 'query_failed', error.message)

  const hasNext = (messages ?? []).length > limit
  const page = (messages ?? []).slice(0, limit).reverse() // oldest-first within page
  const nextCursor = hasNext ? page[0]?.id ?? null : null

  // Active workflow (most recent non-terminal).
  const { data: activeWf } = await service
    .from('workflows')
    .select('id')
    .eq('document_id', conv.document_id)
    .eq('conversation_id', conversationId)
    .in('status', ['draft', 'approved', 'running', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Total message count (final only).
  const { count: messageCount } = await service
    .from('conversation_messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('turn_state', 'final')

  return NextResponse.json({
    conversation: {
      id: conv.id,
      document_id: conv.document_id,
      conversation_summary: conv.conversation_summary,
      summary_covers_through: conv.summary_covers_through,
      message_count: messageCount ?? 0,
      current_workflow_id: activeWf?.id ?? null,
      created_at: conv.created_at,
      updated_at: conv.updated_at,
    },
    messages: page,
    next_cursor: nextCursor,
  })
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.floor(n)))
}
