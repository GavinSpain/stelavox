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

// V1.x-B.2.2 — WFQ + buckets + reserved slots + metrics samplers.
export type {
  WfqWeights,
  WfqClassState,
  WfqCandidate,
  WfqPick,
} from './wfq'
export {
  computeVft,
  applyAgingPromotion,
  pickByMinVft,
  readWfqState,
  updateWfqStateAfterDispatch,
  readWfqClassWeights,
  readAgingThresholdMs,
  DEFAULT_TICKET_COST,
} from './wfq'

export type { BucketSnapshot, ReservationOutcome } from './buckets'
export {
  lazyRefill,
  checkAndReserve,
  reconcile,
  refundExpired,
  poolKeyFor,
} from './buckets'

export type { ClaimOutcome } from './reserved-slots'
export {
  claimClass1Slot,
  releaseClass1Slot,
  readSlotsInUse,
} from './reserved-slots'

export type { DispatcherTickSample } from './metrics-samplers'
export {
  recordDispatcherTickSample,
  recordRouteCapacitySamples,
  readDispatcherSampleSnapshot,
} from './metrics-samplers'
