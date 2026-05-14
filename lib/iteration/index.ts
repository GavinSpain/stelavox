/**
 * V1.x-B.1.1 — lib/iteration public surface (interface contract only).
 *
 * Session-1 ships types only. Session 2 lands store / runner /
 * heartbeat / realtime + the executor refactor that consumes them.
 */

export type {
  IterationStatus,
  FailureClass,
  IterationState,
  IterationResult,
  IterationEvent,
} from './types'
