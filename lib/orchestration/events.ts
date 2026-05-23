/**
 * Canonical event catalogue per entity.
 *
 * The event name names WHO/WHY the transition fired. The DB
 * `allowed_transitions.event_name` column carries these strings for
 * audit / debugging.
 *
 * Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §2.
 */

export const BRIEF_EVENTS = ['propagate_brief_completion', 'cancel_brief'] as const
export type BriefEvent = (typeof BRIEF_EVENTS)[number]

export const BRIEF_STAGE_EVENTS = [
  'evaluate_ready_stage_triggers',
  'attach_workflow_initial',
  'attach_workflow_planned',
  'planning_failed_retry',
  'planning_failed_terminal',
  'complete_brief_stage_workflow',
  'workflow_terminal_failure',
  'cancel_brief',
  'admin_retry_failed_stage',
] as const
export type BriefStageEvent = (typeof BRIEF_STAGE_EVENTS)[number]

export const WORKFLOW_EVENTS = [
  'approve_workflow',
  'cancel',
  'dispatch_first',
  'all_steps_terminal_success',
  'step_failed_or_budget',
  'resume',
] as const
export type WorkflowEvent = (typeof WORKFLOW_EVENTS)[number]

export const WORKFLOW_STEP_EVENTS = [
  'dispatch',
  'stop_request_or_cascade',
  'user_deselect',
  'job_terminal_success',
  'job_terminal_failure',
  'cascade_cancel',
] as const
export type WorkflowStepEvent = (typeof WORKFLOW_STEP_EVENTS)[number]

export const AGENT_JOB_EVENTS = [
  'dispatcher_cas_claim',
  'runner_start_bypass',
  'cancel_or_cascade',
  'persist_running_start',
  'cancel_mid_dispatch',
  'heartbeat_stale_or_stuck_claim',
  'llm_ok',
  'llm_fail',
  'cancel_mid_run',
  'heartbeat_stale',
  'author_accept',
  'author_dismiss',
  'cancel',
] as const
export type AgentJobEvent = (typeof AGENT_JOB_EVENTS)[number]

export const DIRECTOR_TURN_EVENTS = [
  'mark_turn_completed',
  'mark_turn_failed',
  'mark_turn_cancelled',
] as const
export type DirectorTurnEvent = (typeof DIRECTOR_TURN_EVENTS)[number]

export const DIRECTOR_ITERATION_EVENTS = [
  'dispatcher_cas_claim',
  'cancel_or_cascade',
  'iteration_start',
  'cancel_mid_dispatch',
  'heartbeat_stale_or_stuck_claim',
  'iteration_ok',
  'iteration_error_or_missing',
  'cancel_mid_run',
  'heartbeat_stale',
] as const
export type DirectorIterationEvent = (typeof DIRECTOR_ITERATION_EVENTS)[number]
