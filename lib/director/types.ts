/**
 * Director — shared types.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.12-2.16, §2.11.
 *
 * Types only. Imported by lib/director/* and the Director API routes
 * + Edge Functions.
 */

export type WorkflowStepOperationType =
  | 'expand'
  | 'synthesise'
  | 'refine'
  | 'generate_context'
  | 'comment'
  | 'node_reorder'
  | 'node_rename'

export type WorkflowStatus =
  | 'draft'
  | 'approved'
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'

export type WorkflowStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'removed'

export type ConversationMessageRole = 'user' | 'assistant'

// 2026-05-19 Phase 3 cleanup: `WorkflowStepProposal` interface removed.
// It was the create_*_step return shape (Phase 2 dropped those tools)
// and is no longer used anywhere in lib/. The Zod
// `WorkflowStepProposalSchema` in lib/director/schemas.ts is separate
// and stays — it's used by the legacy `<workflow_proposal>` XML
// parser as a defensive fallback (parse-message-proposals.ts) for
// model responses that emit the older XML block format.

/** Tool registry entry. */
export type ToolKind = 'read' | 'write'

export interface DirectorToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
  kind: ToolKind
}

/** Session bound to one Director conversation. */
export interface DirectorSession {
  conversation_id: string
  document_id: string
  organisation_id: string
  user_id: string
}

/** Output of a single read tool execution. */
export interface ReadToolResult {
  ok: true
  data: Record<string, unknown>
}

/**
 * Output of a write tool — produces a proposal artefact, no DB write.
 *
 * Card-surfacing artefacts (one per write tool, mutually exclusive):
 *   - brief_proposal + brief_proposal_full — propose_brief
 *   - profile_amendment_proposal — propose_profile_amendment
 *   - brief_cancellation_proposal — cancel_brief
 *   - workflow_proposal — propose_workflow (system-driven stage planning)
 *   - capability_limit_proposal — report_capability_limit
 *
 * 2026-05-19 Phase 3 cleanup: the legacy `proposal?: WorkflowStepProposal`
 * field was removed.
 * 2026-05-21 simplification: `brief_amendment_proposal?` (V1.x-B.3) was
 * removed; the amendment surface is gone. Replaced by `workflow_proposal`
 * for the system-driven stage-planning path.
 */
export interface WriteToolResult {
  ok: true
  brief_proposal?: BriefProposalArtefact
  /** Full validated Brief proposal — serialised onto tool_result.content. */
  brief_proposal_full?: Record<string, unknown>
  profile_amendment_proposal?: ProfileAmendmentProposalArtefact
  /** V1.x-B.1.1 — destructive Brief cancellation proposal (H-08: propose-only). */
  brief_cancellation_proposal?: BriefCancellationProposalArtefact
  /**
   * 2026-05-21 simplification — workflow proposal emitted when the
   * Director plans a prompt-deferred stage's workflow (stage_trigger_fired
   * system event in the conversation). The iteration runner attaches
   * the workflow to brief_stages.workflow_id; if brief.auto_approve_workflow_proposals
   * is true the workflow runs immediately, otherwise the author sees a PlanCard.
   *
   * Shape: { brief_id, stage_id, stage_order, stage_title, workflow }.
   * `workflow` is the full WorkflowProposalParsed shape.
   */
  workflow_proposal?: WorkflowProposalForStageArtefact
  /** V1.x-F.1 — Capability-limit synthetic proposal (H-08: propose-only). */
  capability_limit_proposal?: CapabilityLimitArtefact
}

/**
 * 2026-05-21 — propose_workflow artefact for system-driven stage planning.
 * The executor resolves which stage is being planned (the unique
 * status='planning' row on the active brief) and includes the stage's
 * id + order + title in the artefact so the iteration runner doesn't
 * have to re-look-up.
 */
export type WorkflowProposalForStageArtefact = {
  brief_id: string
  stage_id: string
  stage_order: number
  stage_title: string
  workflow: Record<string, unknown>
}

/**
 * V1.x-F.1 — Capability-limit artefact. Emitted by the Director when it
 * detects the user's request exceeds its capability boundaries
 * (per-iteration node cap, token-budget headroom, tool-count overflow,
 * or a multi-step batch protocol that doesn't fit in one workflow).
 * Surfaces as CapabilityLimitCard in the conversation thread; no DB
 * write — the user "approves" by reformulating their request.
 */
export type CapabilityLimitArtefact = {
  detected_limit: 'per_iteration_cap' | 'token_budget' | 'tool_count' | 'other'
  suggested_alternative: string
  reason: string
}

/** Re-exports from lib/brief — kept here to avoid a circular import. */
export type BriefProposalArtefact = {
  goal_text: string
  preferences: Record<string, unknown>
  stages: Array<{
    order: number
    title: string
    description?: string
    // 2026-05-21 simplification (M-183): trigger_type narrowed.
    trigger_type: 'after_stage' | 'manual'
    trigger_config?: Record<string, unknown>
  }>
}

export type ProfileAmendmentProposalArtefact = {
  amendment_type: string
  target_path?: string
  after: unknown
  reason: string
}

/**
 * V1.x-B.1.1 — Brief cancellation proposal artefact.
 * The Director recommends cancelling a specific Brief; the user approves
 * via BriefCancellationProposalCard before cancel_brief RPC fires.
 *
 * `brief_status_at_proposal` and `cascade_preview` are computed
 * server-side at proposal time so the user sees an accurate cascade
 * summary on the approval card. The actual cancel_brief RPC computes
 * its own definitive cascade summary at execution time (which may
 * differ slightly if more steps complete between proposal and approval).
 */
export type BriefCancellationProposalArtefact = {
  brief_id: string
  reason: string
  brief_status_at_proposal: 'planned' | 'queued' | 'active'
  cascade_preview: {
    pending_stages: number
    completed_stages: number
    queued_brief_will_promote: boolean
  }
}

export interface ToolErrorResult {
  ok: false
  error: string
  reason?: string
  /**
   * Per-step diagnostics for write tools that validate a list of
   * workflow steps (propose_brief, propose_brief_amendment with
   * add_stage / modify_pending_stage). Populated when one or more
   * steps fail shape, target-id, or lock checks; absent when the
   * error is at the proposal-level (e.g. missing first stage).
   *
   * Each entry carries the location (stage_order + step_index) so the
   * model can match the diagnostic back to the JSON it sent without
   * re-parsing the whole structure.
   */
  per_step_errors?: PerStepError[]
}

/**
 * 2026-05-19 — per-step diagnostic for write-tool validation failures.
 * Phase 1 of the create_*_step deprecation refactor. The model gets
 * structured, actionable feedback for every problematic step in a
 * Brief proposal in one tool_result, instead of trial-and-error
 * one-error-at-a-time iterations.
 */
export interface PerStepError {
  /** Stage's `order` field as the model supplied it (1-indexed). */
  stage_order: number
  /** Step's 0-indexed position in the stage's workflow.steps array. */
  step_index: number
  /** Short error code: e.g. 'invalid_parameters', 'target_node_not_found', 'node_locked', 'node_in_progress'. */
  error: string
  /** Human-readable reason — what's wrong and how to fix it. */
  reason: string
  /** When the issue is on a specific field, the path inside the step (e.g. ['parameters', 'instruction']). */
  path?: (string | number)[]
  /** When the issue is target_node_not_found, the id that didn't exist. */
  target_node_id?: string
}

export type ToolResult = ReadToolResult | WriteToolResult | ToolErrorResult

/** Validation outcome from validateToolCall(). */
export type ValidationResult =
  | { allowed: true }
  | { allowed: false; reason: ValidationDenialReason }

export type ValidationDenialReason =
  | 'cross_org_access_denied'
  | 'cross_document_access_denied'
  | 'node_locked'
  | 'injection_pattern_in_parameters'
  | 'tool_rate_limit_exceeded'
  | 'unknown_tool'
  | 'invalid_parameters'

// ---------------------------------------------------------------------------
// V1.x-B.2.1 — per-iteration execution model
// ---------------------------------------------------------------------------

/**
 * Five-class failure taxonomy (Director Architecture v2.0 §10).
 *   A — TRANSIENT (auto-retry; HTTP 429/5xx, network reset)
 *   B — INTERRUPTED (resumable; crash, Stop, manual cancel)
 *   C — CAPACITY (throttled; Anthropic concurrent limit, bucket exhaustion)
 *   D — VALIDATION (fail hard, user-surfaced; canary leak, malformed JSON)
 *   E — HARD SYSTEM (fail hard, operator action; missing config/migration)
 */
export type FailureClass = 'A' | 'B' | 'C' | 'D' | 'E'

/**
 * Queue lifecycle (M-106). Distinct from agent_jobs.status (business outcome).
 *   queued → dispatched → running → completed | failed | crashed | cancelled
 *   skipped is a transient state used by the dispatcher when capacity is
 *   absent — collapsed into 'queued' with dispatcher_skips_count++.
 */
export type QueueStatus =
  | 'queued'
  | 'dispatched'
  | 'running'
  | 'completed'
  | 'failed'
  | 'crashed'
  | 'cancelled'
  | 'skipped'

/**
 * Director turn — the unit of user-perceived interaction (one user
 * message in, response out). Owns the iteration sequence via
 * agent_jobs.director_turn_id.
 */
export interface DirectorTurn {
  id: string
  conversation_id: string
  user_message_id: string | null
  started_at: string
  completed_at: string | null
  status: 'in_progress' | 'completed' | 'cancelled' | 'failed'
  iteration_count: number
  total_input_tokens: number
  total_output_tokens: number
  total_cost_credits: number
}

/**
 * Iteration state JSONB carried on agent_jobs for director_iteration
 * rows. Versioned via __schema_version (H-21 mitigation).
 *
 * The runner reads __schema_version, applies any in-memory migration if
 * older than current, never persists in mixed shape.
 *
 * Shape rationale: the agentic-loop messages array must alternate
 * assistant↔user with each tool_use immediately followed by its
 * tool_result (Anthropic API protocol). Storing the full alternating
 * array directly is simpler than separating assistant_messages from
 * pending_tool_results — the latter shape made it easy to lose the
 * per-iteration pairing when iteration 3+ rebuilt the prompt.
 *
 * The full array also has a `conversation_context` head pinned at
 * turn-start time so mid-turn system events don't shift context.
 */
export interface IterationStateV1 {
  __schema_version: 1
  /**
   * Conversation context pinned at turn-start time. Prior user/assistant
   * pairs from the same conversation, in order. Replayed first in every
   * iteration's prompt.
   */
  conversation_context: Array<{ role: 'user' | 'assistant'; content: string }>
  /**
   * Full agentic-loop messages array as it grows across iterations.
   * Iteration 1 starts as [{ role:'user', content:user_message }]. After
   * iteration N completes with tool_use, the runner appends
   * { role:'assistant', content:[text + tool_use blocks] } and
   * { role:'user', content:[tool_result blocks] }. Iteration N+1 reads
   * this array directly + prepends conversation_context.
   *
   * `content` is `Array<AssembledContentBlock> | string`; serialised as
   * `unknown` here to keep types JSON-friendly without a runtime
   * dependency on the LLM-provider types.
   */
  messages: Array<{
    role: 'user' | 'assistant'
    content: string | Array<unknown>
  }>
  /** Original user message that started the turn (kept for diagnostic / reset). */
  user_message: { role: 'user'; content: string }
  /** Director system prompt version frozen at turn start. */
  system_prompt_version: string
  /** Model id frozen at turn start. */
  model: string
  /** mentioned_node_ids carried for stable-block hint reproducibility. */
  mentioned_node_ids?: string[]
}

export type IterationState = IterationStateV1

/**
 * Stop request — durable record. Inserted by the Stop API routes,
 * consumed by the dispatcher and per-iteration runner.
 */
export interface StopRequest {
  id: string
  requested_by: string
  requested_at: string
  target_kind: 'director_turn' | 'workflow' | 'brief'
  target_id: string
  reason: string | null
  cascade_count: number | null
  completed_at: string | null
  organisation_id: string
}

/**
 * Cascade summary returned by Stop endpoints — surfaces the count of
 * tickets that will be cancelled to the user before they confirm.
 */
export interface StopCascadeSummary {
  in_flight_count: number
  queued_count: number
  total: number
}

/** Director config row resolved at session start. */
export interface DirectorConfig {
  id: string
  version_number: string
  status: 'production' | 'deprecated'
  system_prompt: string
  tool_suite: string[]
  model_id: string
  model_params: {
    temperature?: number
    max_tokens?: number
    extended_thinking?: boolean
  }
  capability_flags: {
    research_enabled?: boolean
    multi_step_enabled?: boolean
    proactive_observations_enabled?: boolean
    batch_operations_enabled?: boolean
  }
}
