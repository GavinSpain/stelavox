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

/** Output of write-tool executors — accumulated by the agentic loop. */
export interface WorkflowStepProposal {
  operation_type: WorkflowStepOperationType
  target_node_id: string
  parameters: Record<string, unknown>
  description: string
  estimated_duration_seconds: number
  depends_on_step_orders?: number[]
}

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
 * The three optional fields are mutually exclusive: a write tool produces
 * exactly one. Workflow-step proposals (`proposal`) accumulate into a
 * `<workflow_proposal>` block; Brief proposals (`brief_proposal`) become
 * a `<brief_proposal>` block; amendment proposals (`brief_amendment_proposal`)
 * become a `<brief_amendment_proposal>` block. The model is instructed
 * by the system prompt to emit the correct block based on which tools it
 * called this turn.
 */
export interface WriteToolResult {
  ok: true
  proposal?: WorkflowStepProposal
  brief_proposal?: BriefProposalArtefact
  brief_amendment_proposal?: BriefAmendmentProposalArtefact
}

/** Re-exports from lib/brief — kept here to avoid a circular import. */
export type BriefProposalArtefact = {
  goal_text: string
  preferences: Record<string, unknown>
  stages: Array<{
    order: number
    title: string
    description?: string
    trigger_type: 'after_stage' | 'scheduled_at' | 'manual' | 'compound'
    trigger_config?: Record<string, unknown>
  }>
}

export type BriefAmendmentProposalArtefact = {
  amendment_type: string
  target_path?: string
  after: unknown
  reason: string
}

export interface ToolErrorResult {
  ok: false
  error: string
  reason?: string
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
