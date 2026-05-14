/**
 * V1.x-B.1.1 — lib/scheduler public surface (interface contract only).
 *
 * Session-1 ships types + throttle interface stub. Session 2 lands the
 * dispatcher loop, stage-trigger evaluator, recovery sweep, and
 * reservation lifecycle.
 */

export type {
  DispatchableJob,
  SchedulerEnqueueRequest,
  SchedulerEnqueueResult,
  StageTriggerEvent,
} from './types'

export type {
  TrafficClass,
  ThrottleRoute,
  ThrottleDecision,
  MayDispatchInput,
} from './throttleInterface'

export { mayDispatch } from './throttleInterface'

// V1.x-B.1.1 session 3a — runtime substrate.
export type { ReservationInput, ReservationHandle } from './reservation'
export { reserve, consume, release, sweepExpired } from './reservation'

export type { EvaluateStageTriggersResult } from './stageTriggers'
export { evaluateReadyStageTriggers } from './stageTriggers'

export { sweepInterruptedIterations } from './recoverySweep'

// V1.x-B.2.1 — dispatcher + listener + stop-request substrate.
export type { DispatcherTickResult } from './dispatcher'
export { runDispatcherTick } from './dispatcher'

export type { ListenerHandle, ListenerOptions, CompletionPayload } from './listener'
export { startSchedulerListener } from './listener'

export type { ClassifyFailureInput } from './failure-classifier'
export { classifyFailure, isAutoRetryable, requiresUserSurface } from './failure-classifier'

export type { InsertStopRequestInput, InsertStopRequestResult } from './stopRequests'
export {
  insertStopRequest,
  computeStopCascade,
  isDirectorTurnStopRequested,
} from './stopRequests'
