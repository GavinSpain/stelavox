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
  /** Error class for failure cases. */
  error?: 'not_found' | 'lock_lost' | 'illegal_transition' | 'db_error'
  /** Diagnostic message on error. */
  message?: string
}
