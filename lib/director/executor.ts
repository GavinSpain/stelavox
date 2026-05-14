/**
 * V1.x-B.2.1 — Director turn entry point.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.3 +
 *         Director Architecture v2.0 §8.1a (per-iteration decomposition).
 *
 * REPLACED 2026-05-15: the V1.x-A.1 `runAgenticTurn` async generator
 * (943-line single-function executor) is gone. The Director's agentic
 * loop is now decomposed into per-iteration agent_jobs rows of
 * operation_type='director_iteration', each handled by
 * `lib/director/iteration-runner.ts:runIteration`.
 *
 * This file exposes `startDirectorTurn` — the entry point a route
 * handler (or a future scheduler-invoked stage trigger) calls to begin
 * a Director turn:
 *
 *   1. INSERT director_turns row (status='in_progress')
 *   2. Build the initial iteration_state from the conversation context
 *      + user message + system prompt version + model id
 *   3. INSERT the first agent_jobs row of operation_type='director_iteration',
 *      traffic_class=1 (interactive Director user is watching),
 *      iteration_number=1, director_turn_id=<turn>, parent_iteration_id=NULL,
 *      iteration_state=<bootstrap>
 *   4. Return { turnId, firstIterationJobId, assistantMessageId }
 *
 * The caller (route handler in B.2.1; dispatcher tick in a future
 * cutover) then arranges for runIteration(firstIterationJobId) to be
 * invoked. In B.2.1 the route handler runs iterations inline in a loop
 * (preserves SSE wire). In a future polish, the route handler returns
 * 202 immediately and the dispatcher picks up iteration #1.
 *
 * Pure helpers `consumeTextForDelta`, `freshSuppressionState`, and
 * `parseWorkflowProposal` moved to `lib/director/agentic-helpers.ts`
 * and re-exported here for backward compatibility with imports that
 * existed pre-rewrite (mainly tests).
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type {
  DirectorConfig,
  IterationStateV1,
} from '@/lib/director/types'

// Re-export pure helpers so existing call sites (mainly unit tests for
// the suppression state machine) keep working.
export {
  consumeTextForDelta,
  freshSuppressionState,
  parseWorkflowProposal,
  type WorkflowSuppressionState,
} from '@/lib/director/agentic-helpers'

// ---------------------------------------------------------------------------
// startDirectorTurn — turn entry point
// ---------------------------------------------------------------------------

export interface StartDirectorTurnInput {
  supabase: SupabaseClient
  conversationId: string
  userMessageId: string
  /** The pre-created interim assistant_message id (route handler made this row). */
  assistantMessageId: string
  /** The user's new message content (frozen onto iteration_state.user_message). */
  userMessageContent: string
  /** mentioned_node_ids — pinned for the system-prompt's <mentioned_nodes> hint. */
  mentionedNodeIds: string[]
  /** Pinned conversation context (prior user/assistant pairs) from buildConversationContext. */
  conversationContext: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Director config resolved at the route handler. */
  config: DirectorConfig
  organisationId: string
  documentId: string
}

export interface StartDirectorTurnOutput {
  turnId: string
  firstIterationJobId: string
}

/**
 * Create a director_turns row + first iteration agent_jobs row, returning
 * the ids. Caller invokes `runIteration(firstIterationJobId)` (inline
 * or via dispatcher) to drive the turn forward.
 */
export async function startDirectorTurn(
  input: StartDirectorTurnInput,
): Promise<StartDirectorTurnOutput> {
  const { supabase } = input

  // 1. INSERT director_turns row.
  const { data: turn, error: turnErr } = await supabase
    .from('director_turns')
    .insert({
      conversation_id: input.conversationId,
      user_message_id: input.userMessageId,
      status: 'in_progress',
    })
    .select('id')
    .single()

  if (turnErr || !turn) {
    throw new Error(`startDirectorTurn: director_turns insert failed: ${turnErr?.message ?? 'no row returned'}`)
  }

  // 2. Build initial iteration_state. messages starts with the user
  // message that started this turn — the agentic-loop array grows from
  // there as iterations append (assistant_message, tool_result) pairs.
  const iterationState: IterationStateV1 = {
    __schema_version: 1,
    conversation_context: input.conversationContext,
    messages: [{ role: 'user', content: input.userMessageContent }],
    user_message: { role: 'user', content: input.userMessageContent },
    system_prompt_version: input.config.version_number,
    model: input.config.model_id,
    mentioned_node_ids: input.mentionedNodeIds,
  }

  // 3. INSERT first agent_jobs row.
  const { data: job, error: jobErr } = await supabase
    .from('agent_jobs')
    .insert({
      organisation_id: input.organisationId,
      document_id: input.documentId,
      operation_type: 'director_iteration',
      status: 'pending',
      queue_status: 'queued',
      triggered_by: 'director_turn',
      cause: 'user_message',
      traffic_class: 1,
      route: 'platform',
      director_turn_id: turn.id,
      parent_iteration_id: null,
      iteration_number: 1,
      iteration_state: iterationState as unknown as Record<string, unknown>,
    })
    .select('id')
    .single()

  if (jobErr || !job) {
    // Roll back the turn row to avoid orphans.
    await supabase.from('director_turns').delete().eq('id', turn.id)
    throw new Error(`startDirectorTurn: agent_jobs insert failed: ${jobErr?.message ?? 'no row returned'}`)
  }

  return {
    turnId: turn.id,
    firstIterationJobId: job.id,
  }
}
