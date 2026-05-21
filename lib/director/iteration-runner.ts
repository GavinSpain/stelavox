/**
 * V1.x-B.2.1 — per-iteration Director runtime.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.3
 *         + Director Architecture v2.0 §8.1a (per-iteration decomposition).
 *
 * runIteration(jobId) handles ONE iteration of a Director turn:
 *   1. Load the agent_jobs row + iteration_state.
 *   2. Load the parent director_turn + conversation context.
 *   3. Build messages array from iteration_state.assistant_messages +
 *      iteration_state.pending_tool_results.
 *   4. Stop check (cooperative-abort) BEFORE the LLM call.
 *   5. ONE LLM call via provider.streamWithTools.
 *   6. Stop check on response receipt.
 *   7. Parse response: text + tool_use + 4 proposal artefacts.
 *   8. Execute read tools synchronously (write tools build proposals only — H-08).
 *   9. Persist iteration outcome:
 *      - UPDATE conversation_messages with running accumulated text + tool_calls
 *      - UPDATE agent_jobs.iteration_state with the new shape
 *      - UPDATE agent_jobs.queue_status='completed', actual_input_tokens,
 *        actual_output_tokens, cost_credits, completed_at
 *  10. Decide what's next:
 *      - tool_use → INSERT next agent_jobs row of operation_type='director_iteration'
 *        with parent_iteration_id + iteration_number+1 + iteration_state carrying
 *        the next round's assistant_messages + pending_tool_results
 *      - final response → mark director_turns.status='completed'; finalise
 *        conversation_messages
 *      - max iterations reached → Class D fail
 *  11. Yield iteration_done event with next_iteration_job_id (or null).
 *
 * The async generator yields TurnEvent items as the iteration progresses;
 * the consumer (route handler today; Realtime broadcast in a future
 * cutover) maps these to the wire format of its choice.
 *
 * H-25 mitigation: Stop check before LLM call AND on response receipt.
 * If stop fires after the call but before persistence, the response is
 * recorded for forensics on iteration_state.discarded_response and the
 * iteration is marked queue_status='cancelled'.
 *
 * H-21 mitigation: iteration_state JSONB carries __schema_version=1.
 * Future schema evolution applies in-memory migration before persist.
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
  type WorkflowProposalParsed,
  WorkflowProposalSchema,
  BriefProposalV1xA1Schema,
  type BriefProposalV1xA1Parsed,
  ProfileAmendmentProposalSchema,
  type ProfileAmendmentProposalParsed,
  isWriteTool,
} from '@/lib/director/schemas'
import {
  consumeTextForDelta,
  freshSuppressionState,
  parseWorkflowProposal,
  type WorkflowSuppressionState,
} from '@/lib/director/agentic-helpers'
import { isDirectorTurnStopRequested } from '@/lib/scheduler/stopRequests'
import { releaseClass1Slot } from '@/lib/scheduler/reserved-slots'
import { preflightCheck } from '@/lib/constraints/preflight'
import { recordViolation } from '@/lib/constraints/recordViolation'
import { getProvider } from '@/lib/llm/factory'
import { computeCostUsd } from '@/lib/llm/cost'
import { computeJobCostCredits } from '@/lib/cost/pricing'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type {
  AssembledContentBlock,
  AssembledMessage,
  AssembledPrompt,
  TokenUsage,
  ToolCall,
  ToolDefinition,
} from '@/lib/llm/types'
import type {
  DirectorConfig,
  DirectorSession,
  IterationStateV1,
  ToolResult,
} from '@/lib/director/types'
import { persistDraftWorkflow } from '@/lib/director/workflow-executor'

// ---------------------------------------------------------------------------
// IterationEvent — what the runner yields
// ---------------------------------------------------------------------------

export interface BriefCancellationProposalArtefactEvent {
  brief_id: string
  reason: string
  brief_status_at_proposal: 'planned' | 'queued' | 'active'
  cascade_preview: {
    pending_stages: number
    completed_stages: number
    queued_brief_will_promote: boolean
  }
}

export type IterationEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; tool_call_id: string; name: string }
  | {
      type: 'tool_use_complete'
      tool_call_id: string
      name: string
      validation_result: 'allowed' | string
      result_summary: string
      proposal_artefact?: unknown
    }
  | {
      type: 'workflow_proposal'
      proposal: WorkflowProposalParsed
      workflow_id?: string
      /**
       * 2026-05-21 simplification — when set, this workflow_proposal was
       * produced by propose_workflow for a prompt-deferred stage. The
       * iteration runner links the persisted workflow to
       * brief_stages.workflow_id on this stage, transitions the stage
       * from 'planning' to 'planned' (or directly approves it if
       * brief.auto_approve_workflow_proposals=true).
       */
      stage_link?: {
        brief_id: string
        stage_id: string
        stage_order: number
        stage_title: string
      }
    }
  | { type: 'brief_proposal'; proposal: BriefProposalV1xA1Parsed }
  | { type: 'profile_amendment_proposal'; proposal: ProfileAmendmentProposalParsed }
  | { type: 'brief_cancellation_proposal'; proposal: BriefCancellationProposalArtefactEvent }
  | { type: 'capability_limit_proposal'; proposal: Record<string, unknown> }
  | { type: 'iteration_boundary'; iteration: number }
  | {
      type: 'iteration_done'
      iteration_number: number
      next_iteration_job_id: string | null
      stop_reason: string
      usage: TokenUsage
      cost_usd: number | null
      assistant_message_id: string
      turn_complete: boolean
      cancelled: boolean
    }
  | { type: 'error'; error: string; message: string; failure_class?: 'A' | 'B' | 'C' | 'D' | 'E' }

// ---------------------------------------------------------------------------
// runIteration — async generator yielding IterationEvent
// ---------------------------------------------------------------------------

interface RunIterationContext {
  /** Optional pre-loaded provider — saves a re-fetch when caller has one. */
  provider?: never  // reserved; B.2.1 always re-fetches per iteration for simplicity
}

/**
 * Public entry point. Thin wrapper that owns Class 1 reserved-slot
 * lifecycle. The actual iteration body lives in runIterationInner.
 *
 * Slot release hygiene (H-17 — Class 1 reserved-slot leak):
 *
 * The WFQ dispatcher claims a Class 1 reserved slot before invoking the
 * runner (see lib/scheduler/dispatcher.ts §4b — claimClass1Slot). Without
 * an explicit release on every exit path the slot leaks; once
 * class_1_reserved_slots.in_use reaches agent.class_1_max_concurrent_total
 * the dispatcher refuses to dispatch new Class 1 tickets and the Director
 * loop stalls. This was first observed 2026-05-20 when a user-driven
 * 2-stage Brief test left stage 2's director_iteration permanently
 * queued — every dispatcher tick saw the Class 1 pool exhausted (in_use=5
 * against total_slots=3, max_concurrent_total=5) and skipped.
 *
 * Inline-route Director turns (app/api/director/message/route.ts) call
 * runIteration WITHOUT the dispatcher — those iterations carry
 * reservation_id=NULL and DON'T hold a slot. Releasing in that case would
 * over-release; releaseClass1Slot clamps at 0 but the drift still masks
 * the real in_use count.
 *
 * Discrimination: the inner generator sets slotHeld=true after observing
 * a non-null reservation_id on the loaded agent_jobs row (the dispatcher
 * writes reservation_id atomically with queue_status='dispatched'). The
 * outer try/finally releases exactly once on exit, idempotent via the
 * released flag.
 */
export async function* runIteration(
  jobId: string,
  ctx?: RunIterationContext,
): AsyncGenerator<IterationEvent, void, void> {
  let slotHeld = false
  let slotReleased = false
  const setSlotHeld = () => {
    slotHeld = true
  }
  const releaseSlotOnce = async () => {
    if (slotReleased || !slotHeld) return
    slotReleased = true
    try {
      await releaseClass1Slot()
    } catch (err) {
      // Telemetry-only failure; never block iteration completion on it.
      console.error(
        '[iteration-runner] releaseClass1Slot failed',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  try {
    yield* runIterationInner(jobId, ctx, setSlotHeld)
  } finally {
    await releaseSlotOnce()
  }
}

async function* runIterationInner(
  jobId: string,
  _ctx: RunIterationContext | undefined,
  setSlotHeld: () => void,
): AsyncGenerator<IterationEvent, void, void> {
  const supabase = createServiceRoleClient()

  // ---- 1. Load the agent_jobs row + iteration_state ----------------------
  // `reservation_id` and `traffic_class` are read so the outer wrapper can
  // decide whether to release a Class 1 reserved slot on exit. Only
  // dispatcher-invoked iterations carry a non-null reservation_id.
  const { data: jobRow, error: jobErr } = await supabase
    .from('agent_jobs')
    .select(
      'id, organisation_id, document_id, operation_type, queue_status, iteration_number, director_turn_id, parent_iteration_id, iteration_state, reservation_id, traffic_class',
    )
    .eq('id', jobId)
    .maybeSingle()

  // Slot release gate. Defensive double-check on traffic_class even though
  // director_iteration is class 1 by invariant — guards against a future
  // mis-insertion writing a wrong traffic_class.
  if (jobRow?.reservation_id && jobRow?.traffic_class === 1) {
    setSlotHeld()
  }

  if (jobErr || !jobRow) {
    yield { type: 'error', error: 'job_not_found', message: `agent_jobs ${jobId} not found`, failure_class: 'E' }
    return
  }

  if (jobRow.operation_type !== 'director_iteration') {
    yield {
      type: 'error',
      error: 'wrong_operation_type',
      message: `runIteration expects operation_type='director_iteration'; got '${jobRow.operation_type}'`,
      failure_class: 'E',
    }
    return
  }

  if (!jobRow.director_turn_id) {
    yield { type: 'error', error: 'missing_director_turn_id', message: `agent_jobs ${jobId} has no director_turn_id`, failure_class: 'E' }
    return
  }

  if (!jobRow.iteration_state) {
    yield { type: 'error', error: 'missing_iteration_state', message: `agent_jobs ${jobId} has no iteration_state`, failure_class: 'E' }
    return
  }

  const iterationState = jobRow.iteration_state as unknown as IterationStateV1
  if (iterationState.__schema_version !== 1) {
    yield {
      type: 'error',
      error: 'iteration_state_schema_drift',
      message: `iteration_state has __schema_version=${iterationState.__schema_version}; runner supports 1`,
      failure_class: 'E',
    }
    return
  }

  // ---- 2. Load director_turn + conversation + director_config ------------
  const { data: turnRow } = await supabase
    .from('director_turns')
    .select('id, conversation_id, status, iteration_count')
    .eq('id', jobRow.director_turn_id)
    .single()

  if (!turnRow) {
    yield { type: 'error', error: 'turn_not_found', message: `director_turns ${jobRow.director_turn_id} not found`, failure_class: 'E' }
    return
  }

  if (turnRow.status !== 'in_progress') {
    yield { type: 'error', error: 'turn_not_in_progress', message: `turn status is ${turnRow.status}`, failure_class: 'B' }
    await markJobCancelled(supabase, jobId, 'turn_not_in_progress')
    return
  }

  const { data: conversation } = await supabase
    .from('conversations')
    .select('id, organisation_id, document_id')
    .eq('id', turnRow.conversation_id)
    .single()

  if (!conversation) {
    yield { type: 'error', error: 'conversation_not_found', message: `conversation ${turnRow.conversation_id} not found`, failure_class: 'E' }
    return
  }

  // Find the assistant interim conversation_message id for this turn.
  const { data: assistantMsg } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('role', 'assistant')
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!assistantMsg) {
    yield { type: 'error', error: 'assistant_message_not_found', message: 'no assistant message row to update', failure_class: 'E' }
    return
  }
  const assistantMessageId = assistantMsg.id

  // Director config — pulled from production row.
  const { data: configRow } = await supabase
    .from('director_configs')
    .select('id, version_number, status, system_prompt, tool_suite, model_id, model_params, capability_flags')
    .eq('status', 'production')
    .maybeSingle()

  if (!configRow) {
    yield { type: 'error', error: 'no_director_config', message: 'no production director_config row', failure_class: 'E' }
    return
  }

  const config: DirectorConfig = {
    id: configRow.id,
    version_number: configRow.version_number,
    status: configRow.status as 'production' | 'deprecated',
    system_prompt: configRow.system_prompt,
    tool_suite: (configRow.tool_suite as string[]) ?? [],
    model_id: configRow.model_id ?? iterationState.model,
    model_params: (configRow.model_params as DirectorConfig['model_params']) ?? {},
    capability_flags: (configRow.capability_flags as DirectorConfig['capability_flags']) ?? {},
  }

  // Resolve provider — pass jobRow.organisation_id user_id missing here;
  // the existing factory takes the org's BYOK setup. For Director routing
  // a per-user BYOK key (V1.x-B.1.2), use the conversation owner's user_id.
  // Look it up via the conversation's first user message author.
  const { data: firstUserMessage } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('role', 'user')
    .order('sequence', { ascending: true })
    .limit(1)
    .maybeSingle()
  // The author lookup follows the existing /api/director/message route
  // pattern: organisation_members + author. For B.2.1 we resolve via the
  // turn's conversation.organisation_id without a user_id (platform
  // route only). The Director-route BYOK from B.1.2 is preserved by the
  // existing /api/director/message route handler — when the executor
  // rewrite cuts over to the per-iteration model, the route handler
  // still sets up the provider once and (in a future polish) passes it
  // here. For now, factory gets called with the organisation as a
  // standalone BYOK candidate (no user-key BYOK in dispatcher-driven
  // iterations until V1.x-C migrates BYOK to per-org).
  const { provider, modelId } = await getProvider(
    { id: conversation.organisation_id },
    'director',
    config.model_id,
  )
  void firstUserMessage // intentionally not threaded through in B.2.1

  // ---- 3. Stop check (pre-LLM call) -------------------------------------
  if (await isDirectorTurnStopRequested(jobRow.director_turn_id)) {
    yield { type: 'iteration_done', iteration_number: jobRow.iteration_number ?? 1, next_iteration_job_id: null, stop_reason: 'stop_requested', usage: zeroUsage(), cost_usd: 0, assistant_message_id: assistantMessageId, turn_complete: true, cancelled: true }
    await markJobCancelled(supabase, jobId, 'stop_requested')
    await markTurnCancelled(supabase, jobRow.director_turn_id)
    return
  }

  // ---- 4. Build messages array -----------------------------------------
  if (!provider.streamWithTools) {
    yield { type: 'error', error: 'provider_no_stream_tools', message: 'provider does not implement streamWithTools', failure_class: 'E' }
    return
  }

  const messages: AssembledMessage[] = buildMessagesFromIterationState(iterationState)
  const stable = await buildStableBlock(config, [])
  const tools = buildToolDefinitions(config.tool_suite)
  const baseToolDefs: ToolDefinition[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }))

  const prompt: AssembledPrompt = {
    stable,
    dynamic: {
      currentNode: '',
      agentInstruction: '',
      editorialComments: '',
      precedingSiblings: '',
      succeedingSiblings: '',
      securityWrapped: '',
      messages,
    },
    config: {
      model: modelId,
      temperature: config.model_params.temperature ?? 0.7,
      maxTokens: config.model_params.max_tokens ?? 8192,
      stream: true,
      operationType: 'director',
      tools: baseToolDefs,
      extendedThinking: config.model_params.extended_thinking ?? false,
    },
  }

  // ---- 5. Mark dispatched → running, start heartbeat --------------------
  await supabase
    .from('agent_jobs')
    .update({ queue_status: 'running', status: 'running', last_heartbeat_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('queue_status', ['dispatched', 'queued'])

  // Periodic heartbeat ticker. M-165's recovery sweep kills iterations
  // whose last_heartbeat_at is older than 60s — but the iteration's
  // single LLM call can legitimately take longer than that (extended
  // thinking + multiple parallel tool calls in a complex request).
  // Without periodic heartbeats, healthy iterations get false-positive
  // killed mid-flight. Tick every 15s (¼ the threshold) so a single
  // missed tick doesn't trip the sweep.
  //
  // Discovered 2026-05-17 during continued testing — multi-scene
  // review iterations were getting heartbeat-stale-crashed even though
  // they were running correctly. The runner had only ever set the
  // heartbeat once at the start.
  //
  // Stall detection (added same day, after surfacing the inverse bug):
  // a hung LLM call now stays "alive" forever from the sweep's
  // perspective because the ticker pings every 15s regardless of
  // whether the response stream is producing tokens. The ticker now
  // only updates the heartbeat if a stream chunk was received within
  // STREAM_STALL_THRESHOLD_MS. If the stream goes silent, we stop
  // heartbeating and the recovery sweep kills the iteration after its
  // own 60s threshold — total stall-to-killed time ~120s upper bound.
  const STREAM_STALL_THRESHOLD_MS = 60_000
  let lastStreamChunkAt = Date.now()
  const heartbeatTicker = setInterval(() => {
    const silentMs = Date.now() - lastStreamChunkAt
    if (silentMs > STREAM_STALL_THRESHOLD_MS) {
      // Don't heartbeat — let the sweep do its job.
      return
    }
    void supabase
      .from('agent_jobs')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', jobId)
      .in('queue_status', ['running'])
      .then(() => undefined, () => undefined) // swallow; the next tick retries
  }, 15_000)

  // Per-iteration accumulators
  const turnToolCalls: ToolCall[] = []
  const iterationThinkingBlocks: AssembledContentBlock[] = []
  let iterationStopReason = 'unknown'
  let iterationText = ''
  let iterationUsage: TokenUsage = zeroUsage()
  let suppressionState: WorkflowSuppressionState = freshSuppressionState()

  yield { type: 'iteration_boundary', iteration: jobRow.iteration_number ?? 1 }

  // ---- 6. Stream LLM response ------------------------------------------
  try {
    for await (const chunk of provider.streamWithTools(prompt)) {
      lastStreamChunkAt = Date.now()
      switch (chunk.type) {
        case 'text': {
          if (!chunk.text) break
          iterationText += chunk.text
          const r = consumeTextForDelta(chunk.text, suppressionState)
          suppressionState = r.state
          if (r.visible) yield { type: 'text_delta', delta: r.visible }
          break
        }
        case 'tool_use_start': {
          if (chunk.toolStart) {
            yield { type: 'tool_use_start', tool_call_id: chunk.toolStart.id, name: chunk.toolStart.name }
          }
          break
        }
        case 'tool_use_complete': {
          if (chunk.toolCall) turnToolCalls.push(chunk.toolCall)
          break
        }
        case 'thinking_block_complete': {
          if (chunk.thinkingBlock) {
            if (chunk.thinkingBlock.kind === 'thinking') {
              iterationThinkingBlocks.push({ type: 'thinking', thinking: chunk.thinkingBlock.thinking, signature: chunk.thinkingBlock.signature })
            } else {
              iterationThinkingBlocks.push({ type: 'redacted_thinking', data: chunk.thinkingBlock.data })
            }
          }
          break
        }
        case 'message_stop': {
          if (chunk.usage) {
            iterationUsage = chunk.usage
          }
          iterationStopReason = chunk.stopReason ?? 'unknown'
          break
        }
        default:
          break
      }
    }
  } catch (err) {
    clearInterval(heartbeatTicker)
    const msg = err instanceof Error ? err.message : 'unknown_provider_error'
    console.error('[iteration-runner] provider error', { jobId, msg })
    yield { type: 'error', error: 'provider_error', message: msg, failure_class: 'A' }
    await markJobFailed(supabase, jobId, msg, 'A')
    return
  }

  // Flush tail buffer if no suppression engaged.
  if (!suppressionState.suppressing && suppressionState.tail) {
    yield { type: 'text_delta', delta: suppressionState.tail }
  }

  // ---- 7. Stop check (post-receipt; H-25) ------------------------------
  if (await isDirectorTurnStopRequested(jobRow.director_turn_id)) {
    // Discard the response for forensics, mark cancelled.
    await supabase
      .from('agent_jobs')
      .update({
        iteration_state: {
          ...iterationState,
          discarded_response: { text: iterationText, tool_calls: turnToolCalls.map((t) => ({ id: t.id, name: t.name })) },
        } as unknown as Record<string, unknown>,
        actual_input_tokens: iterationUsage.tokens_input,
        actual_output_tokens: iterationUsage.tokens_output,
      })
      .eq('id', jobId)
    clearInterval(heartbeatTicker)
    yield { type: 'iteration_done', iteration_number: jobRow.iteration_number ?? 1, next_iteration_job_id: null, stop_reason: 'stop_requested_post_receipt', usage: iterationUsage, cost_usd: 0, assistant_message_id: assistantMessageId, turn_complete: true, cancelled: true }
    await markJobCancelled(supabase, jobId, 'stop_requested')
    await markTurnCancelled(supabase, jobRow.director_turn_id)
    return
  }

  // ---- 8. Validate + execute tool calls --------------------------------
  const toolResultBlocks: AssembledContentBlock[] = []
  const accumulatedToolCalls: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
    validation_result: string
    executed_at: string
    result_summary: string
    proposal_artefact?: unknown
  }> = []

  const session: DirectorSession = {
    conversation_id: conversation.id,
    document_id: conversation.document_id,
    organisation_id: conversation.organisation_id,
    user_id: '', // resolved if needed by individual tools; B.2.1 substrate path
  }

  for (const call of turnToolCalls) {
    const validation = await validateToolCall({ toolName: call.name, arguments: call.arguments, session })
    if (!validation.allowed) {
      const reason = validation.reason
      accumulatedToolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, validation_result: `denied:${reason}`, executed_at: new Date().toISOString(), result_summary: `Denied: ${reason}` })
      yield { type: 'tool_use_complete', tool_call_id: call.id, name: call.name, validation_result: `denied:${reason}`, result_summary: `Denied: ${reason}` }
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ error: reason }), is_error: true })
      continue
    }

    const executor = getToolExecutor(call.name)
    if (!executor) {
      accumulatedToolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, validation_result: 'denied:unknown_tool', executed_at: new Date().toISOString(), result_summary: 'Unknown tool' })
      yield { type: 'tool_use_complete', tool_call_id: call.id, name: call.name, validation_result: 'denied:unknown_tool', result_summary: 'Unknown tool' }
      toolResultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify({ error: 'unknown_tool' }), is_error: true })
      continue
    }

    let result: ToolResult
    try {
      result = await executor(call.arguments, session)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'tool_execution_error'
      result = { ok: false, error: 'tool_execution_error', reason: msg }
    }

    // H-08 invariant guard (round-3 audit F-100).
    // 2026-05-21 simplification: brief_amendment_proposal replaced by
    // workflow_proposal in the surviving artefacts list.
    if (result.ok && isWriteTool(call.name)) {
      const r = result as { brief_proposal?: unknown; profile_amendment_proposal?: unknown; brief_cancellation_proposal?: unknown; workflow_proposal?: unknown; capability_limit_proposal?: unknown; data?: unknown }
      const hasProposalArtefact =
        r.brief_proposal !== undefined ||
        r.profile_amendment_proposal !== undefined ||
        r.brief_cancellation_proposal !== undefined ||
        r.workflow_proposal !== undefined ||
        r.capability_limit_proposal !== undefined
      if (r.data !== undefined || !hasProposalArtefact) {
        await writeAuditLogEntry({
          event_type: 'h08_violation_write_tool_returned_data',
          severity: 'critical',
          organisation_id: session.organisation_id,
          document_id: session.document_id,
          conversation_id: session.conversation_id,
          metadata: { tool: call.name, has_data: r.data !== undefined, has_brief_proposal: r.brief_proposal !== undefined, has_profile_amendment_proposal: r.profile_amendment_proposal !== undefined, has_brief_cancellation_proposal: r.brief_cancellation_proposal !== undefined, has_workflow_proposal: r.workflow_proposal !== undefined, has_capability_limit_proposal: r.capability_limit_proposal !== undefined },
        })
        result = { ok: false, error: 'h08_invariant_violation', reason: `Write tool ${call.name} returned a result shape that breaches H-08.` }
      }
    }

    const summary = summariseToolResult(call.name, result)
    const r = result as { brief_proposal_full?: unknown; profile_amendment_proposal?: unknown; brief_cancellation_proposal?: unknown; workflow_proposal?: unknown; capability_limit_proposal?: unknown }
    const artefact = r.brief_proposal_full ?? r.profile_amendment_proposal ?? r.brief_cancellation_proposal ?? r.workflow_proposal ?? r.capability_limit_proposal ?? undefined
    accumulatedToolCalls.push({ id: call.id, name: call.name, arguments: call.arguments, validation_result: 'allowed', executed_at: new Date().toISOString(), result_summary: summary, ...(artefact !== undefined ? { proposal_artefact: artefact } : {}) })
    yield { type: 'tool_use_complete', tool_call_id: call.id, name: call.name, validation_result: 'allowed', result_summary: summary, ...(artefact !== undefined ? { proposal_artefact: artefact } : {}) }

    // Atom-size guardrail (V1.x-B.1.1 session 3b).
    // 2026-05-21 simplification: brief_amendment_proposal → workflow_proposal.
    const serialisedToolResult = JSON.stringify(
      result.ok
        ? (result as { data?: unknown }).data ??
          (result as { brief_proposal_full?: unknown }).brief_proposal_full ??
          (result as { brief_proposal?: unknown }).brief_proposal ??
          (result as { profile_amendment_proposal?: unknown }).profile_amendment_proposal ??
          (result as { brief_cancellation_proposal?: unknown }).brief_cancellation_proposal ??
          (result as { workflow_proposal?: unknown }).workflow_proposal ??
          (result as { capability_limit_proposal?: unknown }).capability_limit_proposal
        : result,
    )
    let toolResultContent = serialisedToolResult
    let toolResultIsError = !result.ok
    const sizeBytes = new TextEncoder().encode(serialisedToolResult).length
    const preflight = await preflightCheck('tool_result_size_exceeded', sizeBytes)
    if (!preflight.ok) {
      await recordViolation({
        type: 'tool_result_size_exceeded',
        attempted_value: sizeBytes,
        configured_cap: preflight.violation.configured_cap,
        context: { organisation_id: session.organisation_id, user_id: session.user_id, document_id: session.document_id, tool_name: call.name },
      })
      toolResultContent = JSON.stringify({ ok: false, error: 'tool_result_size_exceeded', reason: preflight.violation.message })
      toolResultIsError = true
    }
    toolResultBlocks.push({ type: 'tool_result', tool_use_id: call.id, content: toolResultContent, is_error: toolResultIsError })
  }

  // ---- 9. Compute cost + persist iteration outcome ---------------------
  // V1.x-C.1.b — compute BOTH dollars (anthropic_pricing → cost_usd) and
  // credits (pricing_rates → cost_credits). Both lookups are tolerant
  // (null on missing rate) — the iteration completes and downstream
  // metrics surfaces show "rate missing" rather than failing the turn.
  const costUsd = await computeCostUsd(iterationUsage, modelId).catch(() => null)
  const costCredits = await computeJobCostCredits(
    supabase,
    modelId,
    new Date(),
    {
      input: iterationUsage.tokens_input,
      output: iterationUsage.tokens_output,
      cacheWrite: iterationUsage.tokens_cache_write,
      cacheRead: iterationUsage.tokens_cache_read,
    },
  ).catch(() => null)
  if (costCredits === null) {
    console.warn('[iteration-runner] no pricing_rates row for model', modelId)
  }

  // Build the assistant message content for THIS iteration (text +
  // thinking blocks + tool_use blocks). Appended to
  // iteration_state.messages for the NEXT iteration's prompt; if there
  // were tool calls, the matching tool_result user message is appended
  // immediately after — preserves the strict assistant→tool_result
  // pairing the Anthropic API requires.
  const assistantContent: AssembledContentBlock[] = []
  for (const tb of iterationThinkingBlocks) assistantContent.push(tb)
  if (iterationText.trim().length > 0) assistantContent.push({ type: 'text', text: iterationText })
  for (const tc of turnToolCalls) assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments })

  const updatedMessages: IterationStateV1['messages'] = [...iterationState.messages]
  if (assistantContent.length > 0) {
    updatedMessages.push({ role: 'assistant', content: assistantContent as unknown as Array<unknown> })
    if (toolResultBlocks.length > 0) {
      updatedMessages.push({ role: 'user', content: toolResultBlocks as unknown as Array<unknown> })
    }
  }

  // Update conversation_messages running accumulator: prepend any text
  // from prior iterations + this iteration's text. tool_calls is
  // accumulated across iterations.
  const { data: currentMsg } = await supabase
    .from('conversation_messages')
    .select('content, tool_calls')
    .eq('id', assistantMessageId)
    .single()
  const priorText = (currentMsg?.content as string | null) ?? ''
  const priorToolCalls = (currentMsg?.tool_calls as unknown[]) ?? []
  const newAccumulatedText = priorText + iterationText
  const newAccumulatedToolCalls = [...priorToolCalls, ...accumulatedToolCalls]

  await supabase
    .from('conversation_messages')
    .update({ content: newAccumulatedText, tool_calls: newAccumulatedToolCalls })
    .eq('id', assistantMessageId)

  // ---- 10. Decide what's next ----------------------------------------
  const stopReason = iterationStopReason
  let nextIterationJobId: string | null = null
  let turnComplete = false

  // Yield end-of-turn proposal events (only when stop_reason !== 'tool_use').
  let workflowProposal: WorkflowProposalParsed | null = null
  let workflowId: string | undefined

  if (stopReason !== 'tool_use') {
    workflowProposal = parseWorkflowProposal(newAccumulatedText)
    if (workflowProposal) {
      try {
        workflowId = await persistDraftWorkflow({
          supabase,
          organisationId: conversation.organisation_id,
          documentId: conversation.document_id,
          conversationId: conversation.id,
          proposal: workflowProposal,
        })
        await supabase.from('conversation_messages').update({ workflow_id: workflowId }).eq('id', assistantMessageId)

        // V1.x-B.2.3 — auto-approve subsequent stages. If this turn is
        // running on a Brief whose auto_approve_workflow_proposals=true
        // is set (push-model stage trigger), POST to the auto-approve
        // route to immediately mark the workflow approved + queue its
        // step agent_jobs. The flag is on briefs.auto_approve_workflow_proposals;
        // we look it up via the Brief that links to this turn's conversation.
        try {
          const briefCheck = await supabase
            .from('briefs')
            .select('id, auto_approve_workflow_proposals')
            .eq('document_id', conversation.document_id)
            .in('status', ['active'])
            .maybeSingle()
          if (briefCheck.data?.auto_approve_workflow_proposals) {
            const cronToken = process.env.CRON_AUTH_TOKEN
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
            await fetch(`${baseUrl}/api/director/turns/${jobRow.director_turn_id}/auto-approve-workflow`, {
              method: 'POST',
              headers: cronToken
                ? { 'content-type': 'application/json', authorization: `Bearer ${cronToken}` }
                : { 'content-type': 'application/json' },
              body: '{}',
            })
          }
        } catch (err) {
          console.error('[iteration-runner] auto-approve check failed', err instanceof Error ? err.message : String(err))
        }
      } catch (err) {
        console.error('[iteration-runner] persistDraftWorkflow failed', { conversation: conversation.id, error: err instanceof Error ? err.message : String(err) })
      }
      yield { type: 'workflow_proposal', proposal: workflowProposal, workflow_id: workflowId }
    }

    // Brief / Profile / Brief-cancellation proposals via tool_calls artefact.
    const briefCall = [...accumulatedToolCalls].reverse().find((c) => c.name === 'propose_brief' && c.proposal_artefact !== undefined)
    if (briefCall) {
      const r = BriefProposalV1xA1Schema.safeParse(briefCall.proposal_artefact)
      if (r.success) yield { type: 'brief_proposal', proposal: r.data }
    } else {
      const amendmentCall = [...accumulatedToolCalls].reverse().find((c) => c.name === 'propose_profile_amendment' && c.proposal_artefact !== undefined)
      if (amendmentCall) {
        const r = ProfileAmendmentProposalSchema.safeParse(amendmentCall.proposal_artefact)
        if (r.success) yield { type: 'profile_amendment_proposal', proposal: r.data }
      } else {
        const cancelCall = [...accumulatedToolCalls].reverse().find((c) => c.name === 'cancel_brief' && c.proposal_artefact !== undefined)
        if (cancelCall) {
          yield { type: 'brief_cancellation_proposal', proposal: cancelCall.proposal_artefact as BriefCancellationProposalArtefactEvent }
        } else {
          // 2026-05-21 simplification — propose_workflow path.
          //
          // The executor returned an artefact with the workflow + the
          // stage_link metadata (brief_id, stage_id, etc.). The runner:
          //   1. Persists the workflow (workflows + workflow_steps rows)
          //   2. Links brief_stages.workflow_id and transitions the
          //      stage from 'planning' → 'planned'
          //   3. If brief.auto_approve_workflow_proposals is true,
          //      POSTs to the auto-approve route which approves the
          //      workflow + queues its agent_jobs
          //   4. Yields a workflow_proposal event with stage_link metadata
          //      so any downstream observer can see what happened
          const proposeWorkflowCall = [...accumulatedToolCalls].reverse().find((c) => c.name === 'propose_workflow' && c.proposal_artefact !== undefined)
          if (proposeWorkflowCall) {
            const artefact = proposeWorkflowCall.proposal_artefact as {
              brief_id: string
              stage_id: string
              stage_order: number
              stage_title: string
              workflow: unknown
            }
            const wf = WorkflowProposalSchema.safeParse(artefact.workflow)
            if (wf.success) {
              let stageWorkflowId: string | undefined
              try {
                stageWorkflowId = await persistDraftWorkflow({
                  supabase,
                  organisationId: conversation.organisation_id,
                  documentId: conversation.document_id,
                  conversationId: conversation.id,
                  proposal: wf.data,
                })
                // Link the persisted workflow to the planning stage and
                // transition the stage back to 'planned' (workflow ready
                // to dispatch). Guard the UPDATE on status='planning'
                // so concurrent fires don't double-write.
                await supabase
                  .from('brief_stages')
                  .update({ workflow_id: stageWorkflowId, status: 'planned' })
                  .eq('id', artefact.stage_id)
                  .eq('status', 'planning')

                // Annotate the assistant message with the workflow_id
                // (matches the legacy XML path's behaviour).
                await supabase
                  .from('conversation_messages')
                  .update({ workflow_id: stageWorkflowId })
                  .eq('id', assistantMessageId)

                // Auto-approve if the brief is configured for it. Same
                // route that handles propose_brief auto-approve.
                try {
                  const briefCheck = await supabase
                    .from('briefs')
                    .select('id, auto_approve_workflow_proposals')
                    .eq('id', artefact.brief_id)
                    .maybeSingle()
                  if (briefCheck.data?.auto_approve_workflow_proposals) {
                    const cronToken = process.env.CRON_AUTH_TOKEN
                    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
                    await fetch(`${baseUrl}/api/director/turns/${jobRow.director_turn_id}/auto-approve-workflow`, {
                      method: 'POST',
                      headers: cronToken
                        ? { 'content-type': 'application/json', authorization: `Bearer ${cronToken}` }
                        : { 'content-type': 'application/json' },
                      body: '{}',
                    })
                  }
                } catch (err) {
                  console.error('[iteration-runner] propose_workflow auto-approve check failed', err instanceof Error ? err.message : String(err))
                }
              } catch (err) {
                console.error('[iteration-runner] propose_workflow persistDraftWorkflow failed', { stage_id: artefact.stage_id, error: err instanceof Error ? err.message : String(err) })
              }

              yield {
                type: 'workflow_proposal',
                proposal: wf.data,
                workflow_id: stageWorkflowId,
                stage_link: {
                  brief_id: artefact.brief_id,
                  stage_id: artefact.stage_id,
                  stage_order: artefact.stage_order,
                  stage_title: artefact.stage_title,
                },
              }
            }
          } else {
            const capabilityLimitCall = [...accumulatedToolCalls].reverse().find((c) => c.name === 'report_capability_limit' && c.proposal_artefact !== undefined)
            if (capabilityLimitCall) {
              yield { type: 'capability_limit_proposal', proposal: capabilityLimitCall.proposal_artefact as Record<string, unknown> }
            }
          }
        }
      }
    }
  }

  if (stopReason === 'tool_use' && toolResultBlocks.length > 0) {
    // Continue to next iteration.
    const nextIterationNumber = (jobRow.iteration_number ?? 1) + 1
    const maxIterations = await getConfigInt('agent.director_max_tool_iterations')

    if (nextIterationNumber > maxIterations) {
      clearInterval(heartbeatTicker)
      yield { type: 'error', error: 'max_iterations_reached', message: `iteration cap ${maxIterations} reached`, failure_class: 'D' }
      await markJobFailed(supabase, jobId, 'max_iterations_reached', 'D')
      await markTurnFailed(supabase, jobRow.director_turn_id)
      yield { type: 'iteration_done', iteration_number: jobRow.iteration_number ?? 1, next_iteration_job_id: null, stop_reason: 'max_iterations_reached', usage: iterationUsage, cost_usd: costUsd, assistant_message_id: assistantMessageId, turn_complete: true, cancelled: false }
      return
    }

    // Build next iteration's iteration_state. The conversation_context
    // is pinned at turn start and carries through every iteration
    // unchanged. updatedMessages already includes this iteration's
    // assistant message + tool_result pair appended above.
    const nextIterationState: IterationStateV1 = {
      __schema_version: 1,
      conversation_context: iterationState.conversation_context,
      messages: updatedMessages,
      user_message: iterationState.user_message,
      system_prompt_version: iterationState.system_prompt_version,
      model: iterationState.model,
      mentioned_node_ids: iterationState.mentioned_node_ids,
    }

    // INSERT next iteration row.
    const { data: nextJob, error: insertErr } = await supabase
      .from('agent_jobs')
      .insert({
        organisation_id: conversation.organisation_id,
        document_id: conversation.document_id,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'iteration_chain',
        traffic_class: 1,
        cause: 'director_iteration',
        director_turn_id: jobRow.director_turn_id,
        parent_iteration_id: jobId,
        iteration_number: nextIterationNumber,
        iteration_state: nextIterationState as unknown as Record<string, unknown>,
      })
      .select('id')
      .single()

    if (insertErr || !nextJob) {
      yield { type: 'error', error: 'next_iteration_insert_failed', message: insertErr?.message ?? 'no row returned', failure_class: 'E' }
      await markJobFailed(supabase, jobId, 'next_iteration_insert_failed', 'E')
      return
    }

    nextIterationJobId = nextJob.id
  } else {
    // Final iteration — turn complete.
    turnComplete = true
    await markTurnCompleted(supabase, jobRow.director_turn_id)
  }

  // Mark this iteration job completed. V1.x-C.1.b fixed the prior
  // mis-write of `cost_credits: costUsd ?? 0` (a TS column collision
  // from the B.2.1 substrate that wrote dollars into the credits column).
  // Now writes the actual pricing_rates-derived credit cost. `cost_usd`
  // is also written so the BYOK dollar surface picks it up.
  //
  // 2026-05-18 (H-26 audit fix): model_id is also written here. The
  // factory.ts getProvider() call above resolves modelId from
  // director_configs.model_id, but the original V1.x-B.2.1 completion
  // path didn't persist it to agent_jobs.model_id. Result: every
  // director_iteration agent_job had NULL model_id, breaking per-model
  // cost attribution and rate-limit analytics. Workflow agent jobs
  // (expand/synthesise/refine/generate_context) write model_id via the
  // older agent runner path and are unaffected.
  await supabase
    .from('agent_jobs')
    .update({
      queue_status: 'completed',
      status: 'completed',
      completed_at: new Date().toISOString(),
      model_id: modelId,
      actual_input_tokens: iterationUsage.tokens_input,
      actual_output_tokens: iterationUsage.tokens_output,
      cost_credits: costCredits ?? null,
      cost_usd: costUsd ?? null,
      iteration_state: {
        ...iterationState,
        messages: updatedMessages,
      } as unknown as Record<string, unknown>,
    })
    .eq('id', jobId)

  // Clear periodic heartbeat — iteration terminated successfully.
  clearInterval(heartbeatTicker)

  yield {
    type: 'iteration_done',
    iteration_number: jobRow.iteration_number ?? 1,
    next_iteration_job_id: nextIterationJobId,
    stop_reason: stopReason,
    usage: iterationUsage,
    cost_usd: costUsd,
    assistant_message_id: assistantMessageId,
    turn_complete: turnComplete,
    cancelled: false,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zeroUsage(): TokenUsage {
  return { tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0 }
}

function buildMessagesFromIterationState(state: IterationStateV1): AssembledMessage[] {
  const messages: AssembledMessage[] = []
  // 1. Conversation context (prior turns in this conversation, pinned at
  //    turn start so they don't shift mid-turn).
  for (const ctx of state.conversation_context ?? []) {
    messages.push({ role: ctx.role, content: ctx.content })
  }
  // 2. The full agentic-loop messages array. Strict alternation
  //    user→assistant→user→... with each tool_use immediately followed
  //    by its tool_result message (Anthropic API protocol).
  for (const m of state.messages) {
    if (typeof m.content === 'string') {
      messages.push({ role: m.role, content: m.content })
    } else {
      messages.push({ role: m.role, content: m.content as unknown as AssembledContentBlock[] })
    }
  }
  return messages
}

async function buildStableBlock(config: DirectorConfig, mentionedNodeIds: string[]): Promise<AssembledPrompt['stable']> {
  const systemPrompt = config.system_prompt
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

function summariseToolResult(toolName: string, result: ToolResult): string {
  if (!result.ok) return `Error: ${result.error}${result.reason ? ` (${result.reason})` : ''}`
  if ('data' in result) {
    const dataLen = JSON.stringify(result.data).length
    return `${toolName}: returned ${dataLen} chars of data`
  }
  if ('brief_proposal' in result && result.brief_proposal) {
    return `${toolName}: brief proposal — ${result.brief_proposal.stages.length} stages`
  }
  if ('profile_amendment_proposal' in result && result.profile_amendment_proposal) {
    return `${toolName}: profile amendment ${result.profile_amendment_proposal.amendment_type}`
  }
  if ('brief_cancellation_proposal' in result && result.brief_cancellation_proposal) {
    const c = result.brief_cancellation_proposal
    return `${toolName}: cancel proposal — brief ${c.brief_id} (${c.cascade_preview.pending_stages} pending, ${c.cascade_preview.completed_stages} completed${c.cascade_preview.queued_brief_will_promote ? ', queued promote' : ''})`
  }
  if ('workflow_proposal' in result && result.workflow_proposal) {
    const wp = result.workflow_proposal as { stage_order?: number; stage_title?: string; workflow?: { steps?: unknown[] } }
    const nSteps = wp.workflow?.steps?.length ?? 0
    return `${toolName}: workflow proposal for stage ${wp.stage_order ?? '?'} (${wp.stage_title ?? 'untitled'}) — ${nSteps} steps`
  }
  if ('capability_limit_proposal' in result && result.capability_limit_proposal) {
    const c = result.capability_limit_proposal as { detected_limit?: string }
    return `${toolName}: capability limit — ${c.detected_limit ?? 'unknown'}`
  }
  return `${toolName}: ok`
}

async function markJobCancelled(supabase: SupabaseClient, jobId: string, reason: string): Promise<void> {
  await supabase
    .from('agent_jobs')
    .update({
      queue_status: 'cancelled',
      status: 'failed',
      completed_at: new Date().toISOString(),
      failure_class: 'B',
      error_message: reason,
    })
    .eq('id', jobId)
}

async function markJobFailed(supabase: SupabaseClient, jobId: string, message: string, klass: 'A' | 'B' | 'C' | 'D' | 'E'): Promise<void> {
  await supabase
    .from('agent_jobs')
    .update({
      queue_status: 'failed',
      status: 'failed',
      completed_at: new Date().toISOString(),
      failure_class: klass,
      error_message: message,
    })
    .eq('id', jobId)
}

async function markTurnCancelled(supabase: SupabaseClient, turnId: string): Promise<void> {
  await supabase
    .from('director_turns')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', turnId)
    .eq('status', 'in_progress')
}

async function markTurnCompleted(supabase: SupabaseClient, turnId: string): Promise<void> {
  await supabase
    .from('director_turns')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', turnId)
    .eq('status', 'in_progress')
}

async function markTurnFailed(supabase: SupabaseClient, turnId: string): Promise<void> {
  await supabase
    .from('director_turns')
    .update({ status: 'failed', completed_at: new Date().toISOString() })
    .eq('id', turnId)
    .eq('status', 'in_progress')
}
