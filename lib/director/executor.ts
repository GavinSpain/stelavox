/**
 * Director — agentic loop executor.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.16, §2.11 (I-2/I-3/
 *         I-10/I-12), TA §8.2.
 * Build Checklist: T-8.
 *
 * Runs the streaming tool-using agentic loop for one Director turn.
 * Yields TurnEvent objects to the caller (the streaming API route);
 * caller maps these to SSE events on the wire.
 *
 * Flow (per TA §8.2 / API Contract §2.16):
 *
 *   1. Build the assembled prompt (system + canary + security frame +
 *      tool definitions). Initial messages array = conversation context
 *      from buildConversationContext().
 *   2. Inside loop (max agent.director_max_tool_iterations):
 *      a. Call provider.streamWithTools(prompt). Yields chunks:
 *         text → 'text_delta' event; tool_use_start → 'tool_use_start';
 *         tool_use_complete → validate + execute + yield with result.
 *      b. On stop_reason='tool_use': append tool_use blocks to assistant
 *         message; append tool_result blocks to messages; loop.
 *      c. On stop_reason='end_turn': parse <workflow_proposal> JSON
 *         block from accumulated text. Yield 'workflow_proposal' event
 *         if present. Yield 'turn_complete' with final usage. Break.
 *      d. On stop_reason='max_tokens': treat as end of turn but flag.
 *   3. Mid-turn persistence (Phase 5b I-12):
 *      - Before loop: INSERT conversation_messages row with
 *        turn_state='interim', content='', tool_calls=[].
 *      - On every tool_use_complete: UPDATE tool_calls JSONB.
 *      - On every iteration boundary: UPDATE content with accumulated text.
 *      - On clean exit: caller transitions turn_state to 'final' with
 *        full final state. On disconnect: caller transitions to
 *        'interrupted'.
 *   4. Canary scan (I-3): runs inside provider.streamWithTools() per
 *      lib/llm/providers/anthropic.ts. Throws SecurityViolationError on
 *      detection; caller maps to SSE 'error' event with director_canary_leak.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getConfigInt } from '@/lib/config/platform-config'
import { wrapContextWithSecurityFrame } from '@/lib/security/security-frame'
import {
  buildToolDefinitions,
  getToolExecutor,
} from '@/lib/director/tools'
import { validateToolCall } from '@/lib/security/tool-validator'
import { writeAuditLogEntry } from '@/lib/security/audit'
import {
  WorkflowProposalSchema,
  type WorkflowProposalParsed,
  isWriteTool,
} from '@/lib/director/schemas'
import type {
  DirectorConfig,
  DirectorSession,
  ToolResult,
} from '@/lib/director/types'
import type {
  AssembledContentBlock,
  AssembledMessage,
  AssembledPrompt,
  LLMProvider,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '@/lib/llm/types'

// ---------------------------------------------------------------------------
// TurnEvent — abstract event stream the route layer maps to SSE
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workflow-proposal text suppression — keeps the literal
// <workflow_proposal>...</workflow_proposal> XML block out of user-visible
// text_delta events. Exported so the state machine is unit-testable
// independent of the full agentic loop.
// ---------------------------------------------------------------------------

export interface WorkflowSuppressionState {
  /** Once true, all subsequent text in this iteration is suppressed. */
  suppressing: boolean
  /** Tail buffer holding chars that might be the start of `<workflow_proposal>`. */
  tail: string
}

const WORKFLOW_OPEN_TAG = '<workflow_proposal>'
const WORKFLOW_TAIL_HOLD = WORKFLOW_OPEN_TAG.length - 1

export function freshSuppressionState(): WorkflowSuppressionState {
  return { suppressing: false, tail: '' }
}

/**
 * Process one text chunk against the suppression state. Returns the visible
 * portion (to yield as `text_delta`) and the new state.
 *
 *  - If already suppressing, the chunk is dropped from output.
 *  - If the open tag appears in (tail + chunk), yield the prefix and
 *    transition to suppressing.
 *  - Otherwise, yield (tail + chunk) minus the trailing WORKFLOW_TAIL_HOLD
 *    chars; hold those as the new tail so a tag split across chunk
 *    boundaries is still detected.
 */
export function consumeTextForDelta(
  chunk: string,
  state: WorkflowSuppressionState,
): { visible: string; state: WorkflowSuppressionState } {
  if (state.suppressing) {
    return { visible: '', state }
  }
  const combined = state.tail + chunk
  const tagIndex = combined.indexOf(WORKFLOW_OPEN_TAG)
  if (tagIndex !== -1) {
    return {
      visible: combined.slice(0, tagIndex),
      state: { suppressing: true, tail: '' },
    }
  }
  const safeLen = Math.max(0, combined.length - WORKFLOW_TAIL_HOLD)
  return {
    visible: combined.slice(0, safeLen),
    state: { suppressing: false, tail: combined.slice(safeLen) },
  }
}

export type TurnEvent =
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_use_start'
      tool_call_id: string
      name: string
    }
  | {
      type: 'tool_use_complete'
      tool_call_id: string
      name: string
      validation_result: 'allowed' | string
      result_summary: string
    }
  | {
      type: 'workflow_proposal'
      proposal: WorkflowProposalParsed
    }
  | {
      type: 'turn_complete'
      stop_reason: string
      usage: TokenUsage
      assistant_message_id: string
      cost_usd: number | null
    }
  | { type: 'iteration_boundary'; iteration: number }
  | { type: 'error'; error: string; message: string }

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface RunAgenticTurnInput {
  session: DirectorSession
  config: DirectorConfig
  provider: LLMProvider
  /** Conversation context (from buildConversationContext) — array of role+content. */
  conversationContext: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The new user message content. */
  userMessageContent: string
  /** Mentioned node IDs (for the system prompt's <mentioned_nodes> block). */
  mentionedNodeIds: string[]
  /** The interim conversation_messages row id (created by the route before invoking). */
  assistantMessageId: string
  /** Service-role supabase for persistence side-effects. */
  supabase: SupabaseClient
}

// ---------------------------------------------------------------------------
// runAgenticTurn — async generator yielding TurnEvent
// ---------------------------------------------------------------------------

export async function* runAgenticTurn(
  input: RunAgenticTurnInput,
): AsyncGenerator<TurnEvent, void, void> {
  const {
    session,
    config,
    provider,
    conversationContext,
    userMessageContent,
    mentionedNodeIds,
    assistantMessageId,
    supabase,
  } = input

  const maxIterations = await getConfigInt('agent.director_max_tool_iterations')
  const tools = buildToolDefinitions(config.tool_suite)

  if (!provider.streamWithTools) {
    yield {
      type: 'error',
      error: 'provider_no_stream_tools',
      message: 'Active LLM provider does not implement streamWithTools()',
    }
    return
  }

  // Prompt assembly. The "stable" half is the system prompt + tool
  // definitions (cache_control eligible). The "dynamic" half is the
  // conversation history + new user message.
  const stable = await buildStableBlock(config, mentionedNodeIds)
  const baseToolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  // SU-47 — proper Anthropic agentic-loop messages array. Mutated across
  // iterations: each tool-use round appends the assistant message
  // (text + tool_use content blocks) and a user message (tool_result
  // content blocks). The model sees its own prior turns as actual
  // assistant messages, which is the protocol the API expects and which
  // dramatically improves convergence on Haiku/Sonnet (see SU-47 in the
  // Phase 5b Test Report).
  const messages: AssembledMessage[] = buildInitialMessages(
    conversationContext,
    userMessageContent,
  )

  // Accumulated assistant text + tool calls across all iterations.
  // These get UPDATEd onto the interim conversation_messages row at
  // each iteration boundary (Phase 5b I-12).
  let accumulatedText = ''
  const accumulatedToolCalls: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
    validation_result: string
    executed_at: string
    result_summary: string
  }> = []

  let totalUsage: TokenUsage = {
    tokens_input: 0,
    tokens_output: 0,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
  }

  let stopReason = 'unknown'
  let workflowProposal: WorkflowProposalParsed | null = null

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    yield { type: 'iteration_boundary', iteration }

    const prompt: AssembledPrompt = {
      stable,
      dynamic: {
        currentNode: '',
        agentInstruction: '',
        editorialComments: '',
        // SU-47: legacy single-string body unused when `messages` is set;
        // kept as empty string for backward compat with the AssembledPrompt
        // shape. The provider reads `messages` first.
        securityWrapped: '',
        messages,
      },
      config: {
        model: config.model_id,
        temperature: config.model_params.temperature ?? 0.7,
        maxTokens: config.model_params.max_tokens ?? 8192,
        stream: true,
        operationType: 'director',
        tools: baseToolDefs,
      },
    }

    // Per-iteration accumulators
    const turnToolCalls: ToolCall[] = []
    let iterationStopReason = 'unknown'
    let iterationText = ''

    // Suppress the `<workflow_proposal>...</workflow_proposal>` block from
    // user-visible text_delta events. The full text still flows into
    // accumulatedText so parseWorkflowProposal can extract the JSON after
    // the loop. The block is rendered to the user as a structured PlanCard
    // (driven by the workflow_proposal SSE event), not as raw XML markup.
    //
    // State machine in `consumeTextForDelta` (exported for unit testing).
    // Reset per iteration — only the final iteration carries the workflow
    // proposal; resetting is defensive against false positives.
    let suppressionState: WorkflowSuppressionState = freshSuppressionState()

    for await (const chunk of provider.streamWithTools(prompt)) {
      switch (chunk.type) {
        case 'text': {
          if (!chunk.text) break
          accumulatedText += chunk.text
          iterationText += chunk.text

          const result = consumeTextForDelta(chunk.text, suppressionState)
          suppressionState = result.state
          if (result.visible) {
            yield { type: 'text_delta', delta: result.visible }
          }
          break
        }
        case 'tool_use_start': {
          if (chunk.toolStart) {
            yield {
              type: 'tool_use_start',
              tool_call_id: chunk.toolStart.id,
              name: chunk.toolStart.name,
            }
          }
          break
        }
        case 'tool_use_complete': {
          if (chunk.toolCall) {
            turnToolCalls.push(chunk.toolCall)
          }
          break
        }
        case 'message_stop': {
          if (chunk.usage) {
            totalUsage = {
              tokens_input: totalUsage.tokens_input + chunk.usage.tokens_input,
              tokens_output: totalUsage.tokens_output + chunk.usage.tokens_output,
              tokens_cache_read:
                totalUsage.tokens_cache_read + chunk.usage.tokens_cache_read,
              tokens_cache_write:
                totalUsage.tokens_cache_write + chunk.usage.tokens_cache_write,
            }
          }
          iterationStopReason = chunk.stopReason ?? 'unknown'
          break
        }
        default:
          break
      }
    }

    // Flush any remaining tail buffer if the iteration ended without
    // entering suppression (no workflow_proposal block this iteration).
    // If suppression engaged, drop the tail — it's part of the suppressed
    // block.
    if (!suppressionState.suppressing && suppressionState.tail) {
      yield { type: 'text_delta', delta: suppressionState.tail }
      suppressionState = { suppressing: false, tail: '' }
    }

    stopReason = iterationStopReason

    // Validate + execute every tool call. Tool result blocks are
    // built directly as AssembledContentBlock for the messages-array
    // append after this loop (SU-47).
    const toolResultBlocks: AssembledContentBlock[] = []
    for (const call of turnToolCalls) {
      const validation = await validateToolCall({
        toolName: call.name,
        arguments: call.arguments,
        session,
      })

      if (!validation.allowed) {
        const reason = validation.reason
        accumulatedToolCalls.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          validation_result: `denied:${reason}`,
          executed_at: new Date().toISOString(),
          result_summary: `Denied: ${reason}`,
        })
        yield {
          type: 'tool_use_complete',
          tool_call_id: call.id,
          name: call.name,
          validation_result: `denied:${reason}`,
          result_summary: `Denied: ${reason}`,
        }
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify({ error: reason }),
          is_error: true,
        })
        continue
      }

      const executor = getToolExecutor(call.name)
      if (!executor) {
        accumulatedToolCalls.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          validation_result: 'denied:unknown_tool',
          executed_at: new Date().toISOString(),
          result_summary: 'Unknown tool',
        })
        yield {
          type: 'tool_use_complete',
          tool_call_id: call.id,
          name: call.name,
          validation_result: 'denied:unknown_tool',
          result_summary: 'Unknown tool',
        }
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify({ error: 'unknown_tool' }),
          is_error: true,
        })
        continue
      }

      let result: ToolResult
      try {
        result = await executor(call.arguments, session)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'tool_execution_error'
        result = { ok: false, error: 'tool_execution_error', reason: msg }
      }

      // B5.4 (round-3 audit F-100): runtime enforcement of H-08
      // ("Director write tools must never execute inside the agentic
      // loop"). Write-tool implementations are required to return a
      // WriteToolResult (carries `proposal`, no DB-side `data`); a
      // future write tool that accidentally writes to the DB and
      // returns a ReadToolResult-shaped object (with `data`) would
      // breach H-08 silently. Type-check at this boundary catches it:
      // if a write tool returned `data` instead of (or alongside)
      // `proposal`, abort the call as an internal invariant violation
      // and surface it via audit_log.
      if (result.ok && isWriteTool(call.name)) {
        const r = result as { proposal?: unknown; data?: unknown }
        if (r.data !== undefined || r.proposal === undefined) {
          await writeAuditLogEntry({
            event_type: 'h08_violation_write_tool_returned_data',
            severity: 'critical',
            organisation_id: session.organisation_id,
            document_id: session.document_id,
            conversation_id: session.conversation_id,
            metadata: {
              tool: call.name,
              has_data: r.data !== undefined,
              has_proposal: r.proposal !== undefined,
            },
          })
          result = {
            ok: false,
            error: 'h08_invariant_violation',
            reason: `Write tool ${call.name} returned a result shape that breaches H-08 (write tools never execute in the agentic loop). The executor aborted the call.`,
          }
        }
      }

      const summary = summariseToolResult(call.name, result)
      accumulatedToolCalls.push({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
        validation_result: 'allowed',
        executed_at: new Date().toISOString(),
        result_summary: summary,
      })
      yield {
        type: 'tool_use_complete',
        tool_call_id: call.id,
        name: call.name,
        validation_result: 'allowed',
        result_summary: summary,
      }
      toolResultBlocks.push({
        type: 'tool_result',
        tool_use_id: call.id,
        content: JSON.stringify(result.ok ? (result as { data?: unknown; proposal?: unknown }).data ?? (result as { proposal?: unknown }).proposal : result),
        is_error: !result.ok,
      })
    }

    // Persist iteration boundary state (Phase 5b I-12).
    await supabase
      .from('conversation_messages')
      .update({
        content: accumulatedText,
        tool_calls: accumulatedToolCalls,
      })
      .eq('id', assistantMessageId)

    if (stopReason === 'tool_use') {
      // SU-47 — append the assistant's response (text + tool_use blocks)
      // as a real assistant message, then append the tool results as a
      // user message with tool_result content blocks. The model sees its
      // own prior turn intact on the next iteration, which is what
      // Anthropic's tool-use protocol expects.
      const assistantContent: AssembledContentBlock[] = []
      if (iterationText.trim().length > 0) {
        assistantContent.push({ type: 'text', text: iterationText })
      }
      for (const tc of turnToolCalls) {
        assistantContent.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.name,
          input: tc.arguments,
        })
      }
      // Anthropic requires non-empty content arrays. If the model emitted
      // no text and no tool calls in this iteration (shouldn't happen on
      // stop_reason='tool_use' but defend anyway), fall through and break.
      if (assistantContent.length === 0) {
        break
      }
      messages.push({ role: 'assistant', content: assistantContent })
      messages.push({ role: 'user', content: toolResultBlocks })
      continue
    }

    // Any non-tool-use stop reason: parse workflow proposal + exit.
    workflowProposal = parseWorkflowProposal(accumulatedText)
    if (workflowProposal) {
      yield { type: 'workflow_proposal', proposal: workflowProposal }
    }
    break
  }

  // Compute cost (caller may overwrite if it has access to a richer cost helper).
  yield {
    type: 'turn_complete',
    stop_reason: stopReason,
    usage: totalUsage,
    assistant_message_id: assistantMessageId,
    cost_usd: null,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function buildStableBlock(
  config: DirectorConfig,
  mentionedNodeIds: string[],
): Promise<AssembledPrompt['stable']> {
  // The system prompt is the production prompt body from director_configs.
  // Phase 5b T-1 has it as a placeholder; T-3 / T-17 iterate the real body.
  const systemPrompt = config.system_prompt

  // Build a minimal stable body — TA's full security frame wrapping
  // happens here too. Phase 5b doesn't include ancestor chains / context
  // nodes (the Director reads those via tools), so the stable body is
  // primarily the system prompt + a brief mentioned-nodes hint.
  const mentionedHint =
    mentionedNodeIds.length > 0
      ? `\n\n<mentioned_nodes>${mentionedNodeIds.map((id) => `<node_id>${id}</node_id>`).join('')}</mentioned_nodes>`
      : ''

  const wrapped = wrapContextWithSecurityFrame(systemPrompt + mentionedHint, '')

  return {
    systemPrompt,
    ancestors: '',
    contextNodes: '',
    styleGuide: '',
    securityWrapped: wrapped.stable,
  }
}

/**
 * Build the initial messages array for a Director turn (SU-47).
 *
 * Replaces the legacy `buildInitialDynamic` flattened-XML wire format.
 * Each prior conversation turn becomes a real assistant or user message;
 * the new author input becomes the final user message in the array.
 *
 * The agentic loop in runAgenticTurn() then appends assistant turns
 * (text + tool_use content blocks) and user turns (tool_result content
 * blocks) to this array on each iteration that stops with `tool_use`.
 */
function buildInitialMessages(
  conversationContext: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessageContent: string,
): AssembledMessage[] {
  const messages: AssembledMessage[] = []
  for (const m of conversationContext) {
    messages.push({ role: m.role, content: m.content })
  }
  messages.push({ role: 'user', content: userMessageContent })
  return messages
}

function summariseToolResult(toolName: string, result: ToolResult): string {
  if (!result.ok) {
    return `Error: ${result.error}${result.reason ? ` (${result.reason})` : ''}`
  }
  if ('data' in result) {
    const dataLen = JSON.stringify(result.data).length
    return `${toolName}: returned ${dataLen} chars of data`
  }
  if ('proposal' in result) {
    return `${toolName}: proposal for ${result.proposal.operation_type} on ${result.proposal.target_node_id}`
  }
  return `${toolName}: ok`
}

/**
 * Locate and parse the <workflow_proposal>...</workflow_proposal> JSON
 * block from the Director's accumulated text. Returns null if absent.
 * Returns null and logs if present-but-malformed (the loop yields a
 * turn_complete without a workflow event in that case).
 */
export function parseWorkflowProposal(text: string): WorkflowProposalParsed | null {
  // Match either a fenced JSON block tagged <workflow_proposal>...</workflow_proposal>
  // or a markdown JSON block followed by the tag. The placeholder system
  // prompt instructs the model to use the tagged form.
  const match = text.match(
    /<workflow_proposal>\s*(?:```json)?\s*([\s\S]*?)\s*(?:```)?\s*<\/workflow_proposal>/,
  )
  if (!match) {
    // Tolerant fallback: a leading `<workflow_proposal>` followed by
    // raw JSON until end-of-string. Useful when the model truncates.
    const lazy = text.match(/<workflow_proposal>\s*([\s\S]*)$/)
    if (!lazy) return null
    try {
      const obj = JSON.parse(lazy[1].trim()) as unknown
      const result = WorkflowProposalSchema.safeParse(obj)
      return result.success ? result.data : null
    } catch {
      return null
    }
  }

  try {
    const obj = JSON.parse(match[1].trim()) as unknown
    const result = WorkflowProposalSchema.safeParse(obj)
    if (!result.success) {
      console.warn('[director] workflow proposal failed schema validation', {
        error: result.error.message,
      })
      return null
    }
    return result.data
  } catch (err) {
    console.warn('[director] workflow proposal JSON parse failed', {
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}
