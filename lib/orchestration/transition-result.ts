/**
 * Shared TransitionResult type used by all entity state machines.
 *
 * Each machine instantiates this with its own state union.
 */

export interface TransitionResult<TState extends string = string> {
  /** True if the UPDATE matched a row. False on optimistic-lock loss or trigger refusal. */
  ok: boolean
  /** The state the row was in before (read-back may be unavailable; null then). */
  priorState: TState | null
  /** The state the row is in after. */
  newState: TState | null
  /**
   * Error class for failure cases.
   * - 'not_found'              — no row matched the id at all
   * - 'lock_lost'              — held an advisory lock and lost it
   * - 'illegal_transition'     — DB trigger raised check_violation (OLD≠NEW but pair not allowed)
   * - 'cas_lost'               — UPDATE filter `.in('state', expected_sources)` matched 0 rows
   *                              (row is not in the expected source state; another writer
   *                              likely moved it; or row not found — caller treats both as "exit silently")
   * - 'no_transition_for_event' — no allowed_transitions row for (event, to_state); caller bug
   * - 'db_error'               — transport / SQL error
   */
  error?: 'not_found' | 'lock_lost' | 'illegal_transition' | 'cas_lost' | 'no_transition_for_event' | 'db_error'
  /** Diagnostic message on error. */
  message?: string
}
