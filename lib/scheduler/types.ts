import 'server-only'

/**
 * V1.x-B.1.1 — Scheduler interface contract types.
 *
 * Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.3 T-3.1
 *         + Director Architecture v2.0 §8 (universal scheduler) + §9 (throttle)
 *         + design record §4 (scheduler-as-direct-manipulation)
 *         + design record §9 (route parameter contract).
 *
 * SESSION-1 SCOPE — types + interface signatures only. Implementation
 * (dispatcher loop, stage trigger evaluator, recovery sweep) lands in
 * session 2 alongside the executor refactor for per-iteration
 * decomposition.
 *
 * The principle (design record §1): "Architecture right in the first
 * stage; implementation can layer." The contract surface lands in
 * V1.x-B.1.1 even where B.2 swaps the policy.
 */

import type { TrafficClass } from './throttleInterface'

// ---------------------------------------------------------------------------
// Job dispatch
// ---------------------------------------------------------------------------

/**
 * A single agent_jobs row's worth of dispatch metadata, surfaced to the
 * throttle interface for an admission decision. Mirrors the M-092
 * schema additions plus the existing agent_jobs.id / organisation_id /
 * profile_id key columns.
 */
export interface DispatchableJob {
  id: string
  organisation_id: string
  profile_id: string | null
  operation_type: string
  traffic_class: TrafficClass
  execution_intent: 'immediate' | 'parked' | 'scheduled' | 'batched_24h'
  scheduled_at: string | null
  cause: string | null
  route: 'platform' | 'byok'
  reservation_id: string | null
}

/**
 * V1.x-B.1.1 — single internal API consumed by both Director write
 * tools (when proposing schedule changes) and SchedulerPanel UI
 * (when the user directly manipulates queue state).
 *
 * Implementation in session 2: pg-cron + lib/scheduler/dispatcher.ts.
 */
export interface SchedulerEnqueueRequest {
  job: Omit<DispatchableJob, 'id' | 'reservation_id'>
  /** Idempotency key — prevents duplicate enqueue from retried API calls. */
  idempotency_key?: string
}

export interface SchedulerEnqueueResult {
  job_id: string
  initial_status: 'pending' | 'running' | 'parked' | 'scheduled'
  estimated_start_at: string | null
}

// ---------------------------------------------------------------------------
// Stage triggers (scheduler-invokes-Director)
// ---------------------------------------------------------------------------

/**
 * Emitted by the scheduler tick body when a stage trigger fires.
 * The downstream consumer creates a system-initiated Director turn
 * and enqueues iteration #1 (per Director Arch v2.0 §8.4).
 *
 * Implementation in session 2.
 */
export interface StageTriggerEvent {
  brief_id: string
  stage_id: string
  stage_order: number
  trigger_type: 'after_stage' | 'scheduled_at' | 'manual' | 'compound'
  document_id: string
  organisation_id: string
}
