/**
 * Canonical state values for every orchestration entity.
 *
 * Source of truth: the DB's `allowed_transitions` table (seeded in
 * M-191) AND the per-entity CHECK constraints (M-192..M-197). This
 * file mirrors them as typed literals for compile-time checks.
 *
 * If you add a state, you MUST:
 *   1. Add the value to the entity's CHECK constraint via migration.
 *   2. Add transitions to `allowed_transitions` via migration.
 *   3. Add the value to the literal type here.
 *
 * CI hook in tests/unit/orchestration-states-coverage.test.ts asserts
 * the three are in sync.
 */

// ---------------------------------------------------------------------------
// Briefs
// ---------------------------------------------------------------------------

export const BRIEF_STATES = ['active', 'completed', 'cancelled'] as const
export type BriefState = (typeof BRIEF_STATES)[number]

export const BRIEF_TERMINAL_STATES: readonly BriefState[] = ['completed', 'cancelled']
export const BRIEF_NON_TERMINAL_STATES: readonly BriefState[] = ['active']

// ---------------------------------------------------------------------------
// Brief stages
// ---------------------------------------------------------------------------

export const BRIEF_STAGE_STATES = [
  'planned',
  'planning',
  'ready',
  'completed',
  'cancelled',
  'failed',
] as const
export type BriefStageState = (typeof BRIEF_STAGE_STATES)[number]

export const BRIEF_STAGE_TERMINAL_STATES: readonly BriefStageState[] = [
  'completed',
  'cancelled',
  'failed',
]
export const BRIEF_STAGE_NON_TERMINAL_STATES: readonly BriefStageState[] = [
  'planned',
  'planning',
  'ready',
]

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export const WORKFLOW_STATES = [
  'draft',
  'approved',
  'running',
  'paused',
  'completed',
  'cancelled',
] as const
export type WorkflowState = (typeof WORKFLOW_STATES)[number]

export const WORKFLOW_TERMINAL_STATES: readonly WorkflowState[] = ['completed', 'cancelled']

// ---------------------------------------------------------------------------
// Workflow steps
// ---------------------------------------------------------------------------

export const WORKFLOW_STEP_STATES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'removed',
] as const
export type WorkflowStepState = (typeof WORKFLOW_STEP_STATES)[number]

export const WORKFLOW_STEP_TERMINAL_STATES: readonly WorkflowStepState[] = [
  'completed',
  'failed',
  'skipped',
  'removed',
]

/**
 * Dependency-satisfying states. Per Q7 in the spec, `'removed'` joins
 * `'completed'` and `'skipped'` as satisfying a step dependency.
 */
export const WORKFLOW_STEP_DEPENDENCY_SATISFIED_STATES: readonly WorkflowStepState[] = [
  'completed',
  'skipped',
  'removed',
]

// ---------------------------------------------------------------------------
// Agent jobs (worker only, post-split)
// ---------------------------------------------------------------------------

export const AGENT_JOB_STATES = [
  'queued',
  'dispatched',
  'running',
  'awaiting_accept',
  'accepted',
  'dismissed',
  'failed',
  'crashed',
  'cancelled',
] as const
export type AgentJobState = (typeof AGENT_JOB_STATES)[number]

export const AGENT_JOB_TERMINAL_STATES: readonly AgentJobState[] = [
  'accepted',
  'dismissed',
  'failed',
  'crashed',
  'cancelled',
]

export const AGENT_JOB_NON_TERMINAL_STATES: readonly AgentJobState[] = [
  'queued',
  'dispatched',
  'running',
  'awaiting_accept',
]

/**
 * States in which an agent_job is dispatchable (the dispatcher's
 * candidate query filter).
 */
export const AGENT_JOB_DISPATCHABLE_STATES: readonly AgentJobState[] = ['queued']

/**
 * States in which an agent_job locks its target node per
 * check_node_writable's node_in_progress branch.
 */
export const AGENT_JOB_LOCK_STATES: readonly AgentJobState[] = [
  'queued',
  'dispatched',
  'running',
  'awaiting_accept',
]

// ---------------------------------------------------------------------------
// Director turns
// ---------------------------------------------------------------------------

export const DIRECTOR_TURN_STATES = [
  'in_progress',
  'completed',
  'failed',
  'cancelled',
] as const
export type DirectorTurnState = (typeof DIRECTOR_TURN_STATES)[number]

export const DIRECTOR_TURN_TERMINAL_STATES: readonly DirectorTurnState[] = [
  'completed',
  'failed',
  'cancelled',
]

// ---------------------------------------------------------------------------
// Director iterations (post-split; mirrors agent_jobs minus awaiting_accept)
// ---------------------------------------------------------------------------

export const DIRECTOR_ITERATION_STATES = [
  'queued',
  'dispatched',
  'running',
  'completed',
  'failed',
  'crashed',
  'cancelled',
] as const
export type DirectorIterationState = (typeof DIRECTOR_ITERATION_STATES)[number]

export const DIRECTOR_ITERATION_TERMINAL_STATES: readonly DirectorIterationState[] = [
  'completed',
  'failed',
  'crashed',
  'cancelled',
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isTerminalAgentJobState(state: AgentJobState): boolean {
  return AGENT_JOB_TERMINAL_STATES.includes(state)
}

export function isTerminalBriefStageState(state: BriefStageState): boolean {
  return BRIEF_STAGE_TERMINAL_STATES.includes(state)
}

export function isAgentJobLocking(state: AgentJobState): boolean {
  return AGENT_JOB_LOCK_STATES.includes(state)
}
