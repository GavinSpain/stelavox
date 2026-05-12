/**
 * Director — conversation context manager + summariser.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.11 invariant I-9.
 *         stelavox_technical_architecture_v1_9.md §8.5.
 * Build Checklist: T-9.
 *
 * Responsibilities:
 *   - getOrCreateConversation       — resolve or create the (single)
 *                                     conversation row for a document
 *   - appendUserMessage             — INSERT user message, return id
 *   - createInterimAssistantMessage — INSERT assistant row with
 *                                     turn_state='interim' (Phase 5b I-12)
 *   - findInterruptedTurn           — find the (at most one) interrupted
 *                                     turn for a conversation (resume path)
 *   - buildConversationContext      — load message history + apply
 *                                     summary if present
 *   - summariseConversation         — inline summary pass when
 *                                     total tokens > threshold
 *
 * The summariser uses the same Director provider/config as the agentic
 * loop. Cost is non-trivial (one Opus/Haiku call per crossing of the
 * threshold) but happens infrequently.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getConfigInt } from '@/lib/config/platform-config'
import { escapeXml } from '@/lib/security/escape-xml'
import { wrapContextWithSecurityFrame } from '@/lib/security/security-frame'
import type { LLMProvider } from '@/lib/llm/types'

// ---------------------------------------------------------------------------
// Conversation row resolution
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string
  document_id: string
  organisation_id: string
  conversation_summary: string | null
  summary_covers_through: number | null
}

export async function getOrCreateConversation(
  supabase: SupabaseClient,
  organisationId: string,
  documentId: string,
): Promise<ConversationRow> {
  // First try to fetch existing.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, document_id, organisation_id, conversation_summary, summary_covers_through')
    .eq('document_id', documentId)
    .eq('organisation_id', organisationId)
    .maybeSingle()

  if (existing) return existing as ConversationRow

  // Create new.
  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      organisation_id: organisationId,
      document_id: documentId,
    })
    .select('id, document_id, organisation_id, conversation_summary, summary_covers_through')
    .single()

  if (error || !created) {
    // Race: another caller created the row between our select and insert.
    // Re-fetch.
    const { data: retry } = await supabase
      .from('conversations')
      .select('id, document_id, organisation_id, conversation_summary, summary_covers_through')
      .eq('document_id', documentId)
      .eq('organisation_id', organisationId)
      .single()
    if (retry) return retry as ConversationRow
    throw new Error(
      `getOrCreateConversation failed: ${error?.message ?? 'no row after retry'}`,
    )
  }

  return created as ConversationRow
}

// ---------------------------------------------------------------------------
// Message append helpers
// ---------------------------------------------------------------------------

export async function appendUserMessage(
  supabase: SupabaseClient,
  conversationId: string,
  authorUserId: string,
  content: string,
  mentionedNodeIds: string[],
): Promise<{ id: string; sequence: number }> {
  const nextSeq = await nextSequence(supabase, conversationId)

  const toolCallsJson =
    mentionedNodeIds.length > 0
      ? [{ _mentioned_node_ids: mentionedNodeIds }]
      : []

  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'user',
      content,
      sequence: nextSeq,
      author_user_id: authorUserId,
      tool_calls: toolCallsJson,
      turn_state: 'final',
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`appendUserMessage failed: ${error?.message}`)
  }

  return { id: data.id, sequence: nextSeq }
}

export async function createInterimAssistantMessage(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ id: string; sequence: number }> {
  const nextSeq = await nextSequence(supabase, conversationId)
  const { data, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversationId,
      role: 'assistant',
      content: '',
      sequence: nextSeq,
      tool_calls: [],
      turn_state: 'interim',
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`createInterimAssistantMessage failed: ${error?.message}`)
  }
  return { id: data.id, sequence: nextSeq }
}

export async function finaliseAssistantMessage(
  supabase: SupabaseClient,
  messageId: string,
  finalContent: string,
  toolCalls: unknown[],
  usage: { tokens_input: number; tokens_output: number; tokens_cache_read: number; tokens_cache_write: number },
  costUsd: number | null,
): Promise<void> {
  await supabase
    .from('conversation_messages')
    .update({
      content: finalContent,
      tool_calls: toolCalls,
      turn_state: 'final',
      tokens_input: usage.tokens_input,
      tokens_output: usage.tokens_output,
      tokens_cache_read: usage.tokens_cache_read,
      tokens_cache_write: usage.tokens_cache_write,
      cost_usd: costUsd,
    })
    .eq('id', messageId)
}

export async function markAssistantInterrupted(
  supabase: SupabaseClient,
  messageId: string,
): Promise<void> {
  await supabase
    .from('conversation_messages')
    .update({ turn_state: 'interrupted' })
    .eq('id', messageId)
    .eq('turn_state', 'interim')
}

export async function findInterruptedTurn(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<{ id: string; sequence: number; content: string; tool_calls: unknown[] } | null> {
  const { data } = await supabase
    .from('conversation_messages')
    .select('id, sequence, content, tool_calls')
    .eq('conversation_id', conversationId)
    .eq('turn_state', 'interrupted')
    .order('sequence', { ascending: false })
    .limit(2)

  if (!data || data.length === 0) return null
  // The route layer asserts at-most-one and returns 500 multiple_interrupted_turns
  // if 2+ rows are found.
  return data[0] as { id: string; sequence: number; content: string; tool_calls: unknown[] }
}

// ---------------------------------------------------------------------------
// Conversation context build (summary-aware)
// ---------------------------------------------------------------------------

export interface ContextMessage {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Build the message history that the agentic loop uses as context.
 * Excludes interim/interrupted assistant turns (they are not finalised
 * outputs from the model's perspective).
 */
export async function buildConversationContext(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ContextMessage[]> {
  const { data: convo } = await supabase
    .from('conversations')
    .select('conversation_summary, summary_covers_through')
    .eq('id', conversationId)
    .maybeSingle()

  let q = supabase
    .from('conversation_messages')
    .select('role, content, sequence, turn_state')
    .eq('conversation_id', conversationId)
    .in('turn_state', ['final'])
    .order('sequence')

  if (convo?.summary_covers_through != null) {
    q = q.gt('sequence', convo.summary_covers_through)
  }

  const { data: messages, error } = await q
  if (error) {
    throw new Error(`buildConversationContext failed: ${error.message}`)
  }

  const result: ContextMessage[] = []
  if (convo?.conversation_summary && convo.summary_covers_through != null) {
    result.push({
      role: 'user',
      content: `[Earlier conversation summary: ${convo.conversation_summary}]`,
    })
  }
  for (const m of messages ?? []) {
    if (m.role === 'user' || m.role === 'assistant') {
      result.push({ role: m.role, content: m.content })
    }
  }
  return result
}

/**
 * Estimate total input tokens for a conversation. Chars/4 heuristic
 * (matches Anthropic's rough English-text rate).
 */
export async function estimateConversationTokens(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<number> {
  const messages = await buildConversationContext(supabase, conversationId)
  let total = 0
  for (const m of messages) total += Math.ceil(m.content.length / 4)
  return total
}

/**
 * Summarisation pass: condenses the oldest half of the messages into a
 * conversation_summary and updates the conversation row. Per TA §8.5
 * and Phase 5b I-9. Uses a non-tool LLM call against the same provider
 * + model the Director uses.
 *
 * Triggered inline by the message route when estimateConversationTokens()
 * exceeds agent.director_session_max_tokens (default 60000).
 */
export async function summariseConversation(
  supabase: SupabaseClient,
  conversationId: string,
  provider: LLMProvider,
  modelId: string,
): Promise<void> {
  const { data: messages } = await supabase
    .from('conversation_messages')
    .select('role, content, sequence')
    .eq('conversation_id', conversationId)
    .eq('turn_state', 'final')
    .order('sequence')

  if (!messages || messages.length === 0) return
  const midpoint = Math.floor(messages.length / 2)
  const oldest = messages.slice(0, midpoint)
  const lastSequence = oldest[oldest.length - 1]?.sequence as number | undefined

  // B5.3 (round-3 audit F-95): the summariser used to pass `promptBody`
  // raw — no escapeXml, no <user_data> wrap, no security frame. A
  // user-injected message reached the summariser verbatim, and any
  // injected instructions then *persisted* in `conversation_summary`
  // for re-inclusion in future Director context (a long-term injection
  // vector). Fix: route through the same security pipeline the agent
  // assembler uses — escapeXml every message field, wrap the whole
  // body in <user_data>, prepend the security header.
  //
  // The stable system text is the summariser's own instructions and
  // never contains user content; it doesn't need wrapping itself, but
  // it gets the security header so the model's interpretation rules
  // are explicit.
  const escapedBody = oldest
    .map((m) => `${escapeXml(m.role.toUpperCase())}: ${escapeXml(m.content as string ?? '')}`)
    .join('\n\n')
  const wrappedDynamic = `<user_data>\n${escapedBody}\n</user_data>`

  const systemText =
    'You are summarising the earlier half of a Director conversation between an author and the Stelavox Director assistant. Produce a compact summary capturing: key decisions made, content the Director read about, plans approved/cancelled, and any open threads. Output plain prose only — no JSON, no headings. Keep under 600 words.'

  const framed = wrapContextWithSecurityFrame(systemText, wrappedDynamic)

  const summaryResponse = await provider.complete({
    stable: {
      systemPrompt: systemText,
      ancestors: '',
      contextNodes: '',
      styleGuide: '',
      securityWrapped: framed.stable,
    },
    dynamic: {
      currentNode: '',
      agentInstruction: '',
      editorialComments: '',
      precedingSiblings: '',
      succeedingSiblings: '',
      securityWrapped: framed.dynamic,
    },
    config: {
      model: modelId,
      temperature: 0.3,
      maxTokens: 1500,
      stream: false,
      operationType: 'director_summarise',
    },
  })

  if (lastSequence != null) {
    await supabase
      .from('conversations')
      .update({
        conversation_summary: summaryResponse.content,
        summary_covers_through: lastSequence,
      })
      .eq('id', conversationId)
  }
}

export async function shouldSummarise(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<boolean> {
  const threshold = await getConfigInt('agent.director_session_max_tokens')
  const total = await estimateConversationTokens(supabase, conversationId)
  return total >= threshold
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function nextSequence(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<number> {
  const { data } = await supabase
    .from('conversation_messages')
    .select('sequence')
    .eq('conversation_id', conversationId)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data?.sequence as number | undefined) ?? 0) + 1
}
