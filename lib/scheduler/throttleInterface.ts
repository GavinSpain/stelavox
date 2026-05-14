import 'server-only'

/**
 * V1.x-B.1.1 — Throttle interface contract.
 *
 * Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.3 T-3.1
 *         + Director Architecture v2.0 §9 (throttling and traffic engineering)
 *         + design record §9 (route parameter; B.1.1 vs B.2 split).
 *
 * SESSION-1 SCOPE — interface signature + B.1.1 trivial policy stub.
 * The cap=1 platform implementation lives here so both Director-iteration
 * jobs and agent_jobs go through one decision surface from day one.
 *
 * B.2 swaps the implementation behind this same interface to add WFQ +
 * per-user buckets + Class 1 reserved slots + reservation lifecycle.
 *
 * Per design record §1: "Architecture right in the first stage;
 * implementation can layer."
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

/** Strict-priority traffic class (Director Arch §9.3). */
export type TrafficClass = 1 | 2 | 3 | 4

/** Dispatch route — platform shared key vs user-supplied BYOK key. */
export type ThrottleRoute = 'platform' | 'byok'

/** Throttle decision shape returned by mayDispatch. */
export type ThrottleDecision =
  | { decision: 'dispatch'; reservation_id: string | null }
  | { decision: 'pace'; retry_after_ms: number; reason: string }
  | { decision: 'reject'; reason: string }

export interface MayDispatchInput {
  route: ThrottleRoute
  traffic_class: TrafficClass
  organisation_id: string
  user_id?: string | null
  /** Estimated input + output tokens for capacity reservation. */
  estimated_tokens?: number
}

/**
 * The single throttle decision surface. EVERY agent_job and Director
 * iteration must pass through this function before opening an Anthropic
 * connection (per Director Arch v2.0 §8.6 pre-call gate).
 *
 * B.1.1 policy:
 *   route='byok' → always dispatch with no reservation (user pays
 *     direct to Anthropic; no platform-side throttle ever).
 *   route='platform' → check throttle.platform_concurrent_dispatch_cap
 *     against running count; dispatch when below cap, pace when at cap.
 *     Preserves M-046 holding-pattern semantics.
 *
 * B.2 swaps this for WFQ + per-user buckets + Class 1 reserved slots.
 * The interface stays.
 */
export async function mayDispatch(input: MayDispatchInput): Promise<ThrottleDecision> {
  if (input.route === 'byok') {
    // Pass-through — BYOK calls go straight to Anthropic on the user's
    // own key. No platform-side throttle ever applies.
    return { decision: 'dispatch', reservation_id: null }
  }

  // Platform route — B.1.1 trivial cap=1 policy.
  const cap = (await getConfig<number>('throttle.platform_concurrent_dispatch_cap')) ?? 1

  const supabase = createServiceRoleClient()
  const { count: runningCount, error } = await supabase
    .from('agent_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('route', 'platform')
    .eq('status', 'running')

  if (error) {
    // Conservative: pace and let the caller retry rather than failing
    // hard on a transient count-query error.
    return { decision: 'pace', retry_after_ms: 1000, reason: `count_query_failed: ${error.message}` }
  }

  if ((runningCount ?? 0) >= cap) {
    return {
      decision: 'pace',
      retry_after_ms: 1000,
      reason: `platform_at_cap (cap=${cap}, running=${runningCount ?? 0})`,
    }
  }

  // Capacity available. B.1.1 returns no reservation_id — the full
  // reservation lifecycle (insert + consume + release) lands in B.2
  // alongside the WFQ scheduler. The interface field is reserved.
  return { decision: 'dispatch', reservation_id: null }
}
