/**
 * V1.x-B.1.1 — lib/iteration public surface.
 *
 * Session 1 shipped types. Session 3b lands store + heartbeat + realtime
 * substrate. Session 3c's executor refactor naturally creates runner.ts
 * as part of carving up the existing single-function executor; landing
 * runner.ts in 3b without the executor refactor would be dead code.
 */

export type {
  IterationStatus,
  FailureClass,
  IterationState,
  IterationResult,
  IterationEvent,
} from './types'

export type { IterationRow, SaveIterationStateInput } from './store'
export {
  createIteration,
  loadIterationState,
  beginIteration,
  saveIterationState,
  getLastCompletedIteration,
} from './store'

export type { HeartbeatHandle } from './heartbeat'
export { heartbeatOnce, startHeartbeat } from './heartbeat'

export {
  publishIterationEvent,
  publishIterationEvents,
  channelNameFor,
} from './realtime'
