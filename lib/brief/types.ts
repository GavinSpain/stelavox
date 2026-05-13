/**
 * Brief — shared types.
 *
 * Source: stelavox_director_architecture_v2_0.md §6 + V1.x-A build
 * checklist §3.2.
 *
 * Types only. Imported by lib/brief/* and the Brief API routes + the
 * Director tool registry write-proposal builders.
 */

export type BriefStatus = 'active' | 'completed' | 'cancelled' | 'archived'

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

export type BriefAmendmentProposedBy = 'user' | 'director'

/**
 * Supported amendment types in V1.x-A. Stage roadmap amendments
 * (insert_stage / remove_stage / reorder_stages / update_stage) are
 * deferred to V1.x-B alongside the trigger evaluator.
 */
export type BriefAmendmentType =
  | 'initial_brief'                // emitted only by apply_brief_proposal
  | 'update_goal_text'
  | 'update_voice'
  | 'add_constraint'
  | 'update_constraints'
  | 'add_decision'
  | 'update_decisions'
  | 'update_named_entities'
  | 'generic_preferences_set'

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
  | Record<string, never>                              // manual → {}

/**
 * Preferences shape held in briefs.preferences JSONB. Unknown keys are
 * allowed (forward-compat) but the typed shape covers the V1.x-A
 * recognised fields. preferencesValidator enforces these at write time
 * per H-18.
 */
export interface BriefPreferences {
  voice?: string
  constraints?: string[]
  decisions?: string[]
  named_entities?: Record<string, string>
  [k: string]: unknown
}

/** A single Brief row (mirrors briefs table). */
export interface Brief {
  id: string
  document_id: string
  organisation_id: string
  status: BriefStatus
  goal_text: string | null
  preferences: BriefPreferences
  current_stage_id: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
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
  started_at: string | null
  completed_at: string | null
  created_at: string
}

/** A single brief_amendments row. */
export interface BriefAmendment {
  id: string
  brief_id: string
  proposed_by: BriefAmendmentProposedBy
  amendment_type: BriefAmendmentType | string         // string fallthrough for forward-compat
  target_path: string | null
  before: unknown
  after: unknown
  approved_at: string
  approved_by_user_id: string | null
  reason: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Director-facing payloads
// ---------------------------------------------------------------------------

/**
 * Flattened response of get_brief_state. Source: V2 doc §6.3.
 *
 * Returned by lib/brief/getBriefState. Consumed by the get_brief_state
 * tool handler and by the BriefViewer + BriefProposalCard surfaces.
 */
export interface BriefStatePayload {
  goal_text: string | null
  status: BriefStatus
  current_stage: Pick<BriefStage, 'order' | 'title' | 'status'> | null
  stages: Array<Pick<BriefStage, 'order' | 'title' | 'description' | 'trigger_type' | 'status'>>
  preferences: BriefPreferences
  recent_amendments: Array<
    Pick<BriefAmendment, 'amendment_type' | 'target_path' | 'reason' | 'approved_at' | 'proposed_by'>
  >
}

// ---------------------------------------------------------------------------
// Proposal artefacts (Director write-tools)
// ---------------------------------------------------------------------------

/** Stage shape inside a <brief_proposal> artefact. */
export interface BriefProposalStageInput {
  order: number
  title: string
  description?: string
  trigger_type: BriefStageTriggerType
  trigger_config?: BriefStageTriggerConfig
}

/** Output of propose_brief tool — emitted as <brief_proposal> content block. */
export interface BriefProposal {
  goal_text: string
  preferences: BriefPreferences
  stages: BriefProposalStageInput[]
}

/** Output of propose_brief_amendment tool — emitted as <brief_amendment_proposal> content block. */
export interface BriefAmendmentProposal {
  amendment_type: BriefAmendmentType
  target_path?: string                                // omitted for update_goal_text
  after: unknown
  reason: string
}

// ---------------------------------------------------------------------------
// RPC result envelopes
// ---------------------------------------------------------------------------

export interface BriefRpcResult {
  brief: Brief
  stages: BriefStage[]
}
