import 'server-only'

/**
 * V1.x-B.2.1 — failure-class classifier (TS implementation).
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.6 + M-110
 *         + Director Architecture v2.0 §10 (5-class taxonomy).
 *
 * Mirrors the M-110 SQL function `classify_failure(...)` exactly so unit
 * tests can run without a database round-trip. The SQL function exists
 * for the dispatcher's recovery sweep (which classifies inside the
 * transaction); this TS function exists for runners + tests.
 *
 * Five classes:
 *   A — TRANSIENT (auto-retry up to N times)
 *   B — INTERRUPTED (resumable; user-visible)
 *   C — CAPACITY (throttled; re-queue)
 *   D — VALIDATION (fail hard; user diagnostic)
 *   E — HARD SYSTEM (fail hard; operator action)
 */

import type { FailureClass } from '@/lib/director/types'

export interface ClassifyFailureInput {
  operationType: string
  errorCode: string
  /** Set to 0 if no HTTP status applies (e.g. internal error). */
  httpStatus?: number
  retryCount?: number
}

const CLASS_A_HTTP = new Set([408, 429, 502, 503, 504])

const CLASS_A_CODES = new Set([
  'network_reset',
  'network_timeout',
  'body_parse_failure',
  'connection_reset',
  'econnreset',
  'etimedout',
  'eai_again',
])

const CLASS_B_CODES = new Set([
  'stop_requested',
  'cancelled_by_user',
  'process_crash',
  'recovery_sweep_reclaim',
  'heartbeat_expired',
  'client_disconnect',
])

const CLASS_C_CODES = new Set([
  'bucket_exhausted',
  'capacity_unavailable',
  'reservation_expired',
  'requeue_patience_exhausted',
])

const CLASS_D_CODES = new Set([
  'tool_input_invalid',
  'output_schema_invalid',
  'malformed_json',
  'canary_leak',
  'canary_leak_detected',
  'injection_blocked',
  'h08_invariant_violation',
  'tool_result_size_exceeded',
  'max_iterations_reached',
  'model_output_truncated',
])

const CLASS_E_CODES = new Set([
  'missing_config',
  'missing_migration',
  'missing_agent_profile',
  'agent_profile_not_found',
  'job_missing_profile_or_node',
  'broken_db_constraint',
  'configuration_error',
])

/**
 * Classify a failure into the five-class taxonomy.
 *
 * Conservative default: when inputs don't clearly map to A/C/D/E,
 * return 'B' (interrupted/resumable). 'B' is the safest default
 * because it surfaces to the user as recoverable.
 */
export function classifyFailure(input: ClassifyFailureInput): FailureClass {
  const { errorCode, httpStatus = 0 } = input

  // Class A — transient (auto-retry candidate). Plain HTTP-status-based 429
  // is class A; the explicit Anthropic concurrent-limit variant below is
  // class C.
  if (CLASS_A_HTTP.has(httpStatus)) {
    // Explicit override: Anthropic 429 with the concurrent-limit code is
    // capacity (C), not transient (A).
    if (httpStatus === 429 && errorCode === 'anthropic_concurrent_limit') {
      return 'C'
    }
    return 'A'
  }

  if (CLASS_A_CODES.has(errorCode)) {
    return 'A'
  }

  // Class B — interrupted (resumable)
  if (CLASS_B_CODES.has(errorCode)) {
    return 'B'
  }

  // Class C — capacity (throttled)
  if (CLASS_C_CODES.has(errorCode)) {
    return 'C'
  }

  // Class D — validation (fail hard)
  if (CLASS_D_CODES.has(errorCode)) {
    return 'D'
  }

  // Class E — hard system (operator action)
  if (CLASS_E_CODES.has(errorCode)) {
    return 'E'
  }

  // HTTP 5xx not in the explicit list above → A by default.
  if (httpStatus >= 500 && httpStatus < 600) {
    return 'A'
  }

  // HTTP 4xx not in the explicit list above → D by default
  // (validation: caller did something wrong, not retryable).
  if (httpStatus >= 400 && httpStatus < 500) {
    return 'D'
  }

  // Conservative default: B (interrupted, resumable, user-visible).
  return 'B'
}

/**
 * Whether a Class A failure is eligible for auto-retry given the
 * configured retry budget. Caller reads agent.failure_class_a_max_retries
 * and passes it as `maxRetries`.
 */
export function isAutoRetryable(klass: FailureClass, retryCount: number, maxRetries: number): boolean {
  return klass === 'A' && retryCount < maxRetries
}

/**
 * Whether a failure should surface to the user (vs. silently re-queue).
 * Class A and Class C are silent (retried/re-queued); B/D/E surface.
 */
export function requiresUserSurface(klass: FailureClass): boolean {
  return klass === 'B' || klass === 'D' || klass === 'E'
}
