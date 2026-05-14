import 'server-only'

/**
 * V1.x-B.1.1 — Director per-iteration substrate types (interface contract).
 *
 * Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.3 T-3.2
 *         + Director Architecture v2.0 §8.1a (per-iteration decomposition)
 *         + design record §6.
 *
 * SESSION-1 SCOPE — types only. The runner / store / heartbeat / realtime
 * publish helpers + the executor refactor that consumes them all land
 * in session 2.
 *
 * The substrate is documented in M-093 (director_iterations table). One
 * row per iteration; per-iteration function picks up the next row off
 * the scheduler queue, runs one Anthropic call, persists state, exits.
 * Crash recovery is automatic at iteration boundaries: heartbeat-based
 * interrupted detection (M-099 sweep_interrupted_iterations) marks
 * stale-heartbeat running rows as 'interrupted'; the dispatcher
 * re-enqueues them at the same iteration_number (idempotent).
 */

export type IterationStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'

/** Five-class failure taxonomy as data shape (Director Arch v2.0 §10). */
export type FailureClass = 'A' | 'B' | 'C' | 'D' | 'E'

/**
 * The persisted state needed to resume an iteration cleanly. Stored
 * in director_iterations.messages_snapshot + accumulated_proposals.
 *
 * Idempotency invariant per design record §6: deterministic inputs
 * (messages array + tool definitions + system prompt) + propose-only
 * (write tools don't write during the loop) → safe to retry.
 */
export interface IterationState {
  turn_id: string
  iteration_number: number
  /** Anthropic messages-array state at iteration start (SU-47 protocol). */
  messages_snapshot: unknown[]
  /** Proposals accumulated across iterations 1..N-1 of this turn. */
  accumulated_proposals: unknown[]
}

/**
 * Result of running a single iteration. The caller decides whether to
 * enqueue iteration N+1 based on next_iteration_needed.
 */
export interface IterationResult {
  iteration_number: number
  next_iteration_needed: boolean
  status: Exclude<IterationStatus, 'pending' | 'running'>
  failure_class?: FailureClass
  failure_message?: string
  tokens_in?: number
  tokens_out?: number
  cost_credits?: number
  /** Updated state to persist for iteration N+1 (or final). */
  next_state?: IterationState
}

/**
 * Realtime-channel events emitted by the iteration runner. Clients
 * subscribe to `director_turn:{turn_id}` and consume these events to
 * stream the Director conversation in real time across function
 * boundaries.
 */
export type IterationEvent =
  | { type: 'iteration_start'; iteration_number: number }
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use_start'; tool_call_id: string; name: string }
  | {
      type: 'tool_use_complete'
      tool_call_id: string
      name: string
      result_summary: string
      proposal_artefact?: unknown
    }
  | { type: 'iteration_complete'; iteration_number: number; status: IterationStatus }
  | { type: 'turn_complete'; iteration_count: number }
  | { type: 'error'; error: string; message: string }
