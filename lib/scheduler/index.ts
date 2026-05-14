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
