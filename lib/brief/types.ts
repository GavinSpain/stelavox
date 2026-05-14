/**
 * Brief (operation-level) — shared types.
 *
 * Source: stelavox_director_architecture_v2_1_0.md §6.2 + V1.x-A.1 build
 * checklist §3.3.
 *
 * Brief is the operation plan artefact — one per Director-driven unit of
 * work. n=1 stage is the trivial case. Multiple Briefs per document over
 * time; one active at a time during V1.x-A.1.
 */

export type BriefStatus = 'planned' | 'queued' | 'active' | 'completed' | 'cancelled'

export type BriefCause = 'user_initial' | 'sequence_promotion'

export type BriefStageTriggerType =
  | 'after_stage'
  | 'scheduled_at'
  | 'manual'
  | 'compound'

export type BriefStageStatus =
  | 'planned'
  | 'proposing'
  | 'proposed'
  | 'approved'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'skipped'

/** Trigger config payloads keyed by trigger_type. */
export interface BriefStageTriggerConfigAfterStage {
  after_stage_order: number
}
export interface BriefStageTriggerConfigScheduledAt {
  scheduled_at: string
}
export interface BriefStageTriggerConfigCompound {
  conditions: Array<
    | { type: 'after_stage'; after_stage_order: number }
    | { type: 'scheduled_at'; scheduled_at: string }
  >
}
export type BriefStageTriggerConfig =
  | BriefStageTriggerConfigAfterStage
  | BriefStageTriggerConfigScheduledAt
  | BriefStageTriggerConfigCompound
  | Record<string, never>

/** A single briefs row. */
export interface Brief {
  id: string
  document_id: string
  organisation_id: string
  goal_text: string
  status: BriefStatus
  /** V1.x-B.1.1 — per-document queue ordering (0 = active, 1+ = queued). */
  sequence_position: number
  /** V1.x-B.1.1 — activation cause for audit + future template work. */
  cause: BriefCause
  current_stage_id: string | null
  created_at: string
  approved_at: string | null
  started_at: string | null
  completed_at: string | null
  cancelled_at: string | null
}

/** A single brief_stages row. */
export interface BriefStage {
  id: string
  brief_id: string
  order: number
  title: string
  description: string | null
  trigger_type: BriefStageTriggerType
  trigger_config: BriefStageTriggerConfig
  status: BriefStageStatus
  workflow_id: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Director-facing payload
// ---------------------------------------------------------------------------

/**
 * Flattened response shape for an individual Brief. Returned by
 * getBriefById and used as the `active` field inside BriefQueueState.
 * Source: V2.1 §6.2.3 + V1.x-B.1.1 build checklist §3.3 T-3.5.
 */
export interface BriefStatePayload {
  brief_id: string
  goal_text: string
  status: BriefStatus
  sequence_position: number
  cause: BriefCause
  current_stage: Pick<BriefStage, 'order' | 'title' | 'status'> | null
  stages: Array<
    Pick<BriefStage, 'order' | 'title' | 'description' | 'trigger_type' | 'status' | 'workflow_id'> & {
      trigger_config: BriefStageTriggerConfig
    }
  >
}

/**
 * Lite shape for queued Briefs — surfaced inside BriefQueueState.queue.
 * No full stage list (Director sees `goal_text` + position; can call
 * get_brief_state with a specific brief_id if it needs detail).
 */
export interface BriefStateLite {
  brief_id: string
  goal_text: string
  status: BriefStatus
  sequence_position: number
  cause: BriefCause
  stage_count: number
  created_at: string
}

/**
 * V1.x-B.1.1 — get_brief_state shape. Returns the document's active
 * Brief (or null) plus an ordered queue of approved-but-waiting Briefs.
 *
 * Director sees: at most one active; queue ordered by sequence_position;
 * empty queue when nothing waiting. The Director's queue-vs-pivot
 * decision happens here (system prompt v1.7).
 */
export interface BriefQueueState {
  active: BriefStatePayload | null
  queue: BriefStateLite[]
}

/** V1.x-B.1.1 — cancel_brief RPC return shape. */
export interface CancelBriefResult {
  brief_id: string
  cancelled_count: number
  completed_count: number
  promoted_brief_id: string | null
}

// ---------------------------------------------------------------------------
// Proposal artefact (Director write-tool)
// ---------------------------------------------------------------------------

/** Stage shape inside a <brief_proposal> artefact. */
export interface BriefProposalStageInput {
  order: number
  title: string
  description?: string
  trigger_type: BriefStageTriggerType
  trigger_config?: BriefStageTriggerConfig
  /** Stage 1's workflow is required; stages 2..N may have null (just-in-time planning). */
  workflow: BriefProposalWorkflowInput | null
}

/** Workflow shape inside a stage (mirrors existing WorkflowStepProposal vocabulary). */
export interface BriefProposalWorkflowInput {
  title: string
  description?: string
  impact_summary?: string
  estimated_total_minutes?: number
  steps: BriefProposalStepInput[]
}

export interface BriefProposalStepInput {
  operation_type: 'expand' | 'synthesise' | 'refine' | 'generate_context' | 'comment' | 'node_reorder'
  target_node_id: string
  description: string
  estimated_duration_seconds: number
  parameters?: Record<string, unknown>
  depends_on_step_orders?: number[]
}

/** Output of propose_brief — emitted as <brief_proposal> content block. */
export interface BriefProposal {
  goal_text: string
  stages: BriefProposalStageInput[]
}

// ---------------------------------------------------------------------------
// RPC result envelopes
// ---------------------------------------------------------------------------

export interface BriefRpcResult {
  brief: Brief
  stages: BriefStage[]
}
