import 'server-only'

/**
 * V1.x-B.2.2 — Class 1 reserved-slot management.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.5 +
 *         Director Architecture v2.0 §9.5.
 *
 * Class 1 (interactive Director iterations the user is watching) gets
 * reserved concurrent-connection slots that no other class can take.
 *
 * Three outcomes for a Class 1 dispatch attempt:
 *   'reserved' — claimed a reserved slot (in_use < total_slots)
 *   'overflow' — reserved slots full, but the global non-class-1 slot
 *                budget hasn't been exhausted; took an overflow slot
 *   'denied'   — both reserved + overflow exhausted; ticket re-queued
 *
 * Released at runner completion or recovery sweep.
 *
 * The counter is a single-row table (M-113) with `in_use` mutated via
 * optimistic CAS to prevent over-claim under concurrent dispatchers.
 *
 * Non-class-1 tickets do NOT touch this counter — their dispatch is
 * gated only by the token bucket. The "global concurrent" cap is a
 * function of `agent.class_1_max_concurrent_total` minus current
 * Class-1 use; if a non-class-1 wants to dispatch when class 1's total
 * is already at cap, it just dispatches (Anthropic's own rate limit
 * gates the absolute ceiling).
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

export type ClaimOutcome = 'reserved' | 'overflow' | 'denied'

interface ReservedSlotRow {
  total_slots: number
  in_use: number
}

/**
 * Attempt to claim a Class 1 slot. Returns 'reserved' | 'overflow' | 'denied'.
 *
 * On 'reserved': in_use was incremented; caller must release on completion.
 * On 'overflow': in_use was incremented; caller must release on completion.
 *                (The release-bookkeeping is the same for both — the
 *                difference matters for telemetry only.)
 * On 'denied': in_use unchanged; caller re-queues the ticket.
 *
 * Optimistic CAS via `eq('in_use', observedInUse)` prevents over-claim
 * under concurrent dispatchers. Bounded retry budget on CAS contention.
 */
export async function claimClass1Slot(): Promise<ClaimOutcome> {
  const supabase = createServiceRoleClient()
  const class1MaxTotal = (await getConfig<number>('agent.class_1_max_concurrent_total')) ?? 5
  const maxAttempts = 5

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row } = await supabase
      .from('class_1_reserved_slots')
      .select('total_slots, in_use')
      .eq('id', 1)
      .single()
    if (!row) return 'denied'

    const r = row as unknown as ReservedSlotRow

    let outcome: ClaimOutcome
    if (r.in_use < r.total_slots) {
      outcome = 'reserved'
    } else if (r.in_use < class1MaxTotal) {
      outcome = 'overflow'
    } else {
      return 'denied'
    }

    const { data: updated, error } = await supabase
      .from('class_1_reserved_slots')
      .update({ in_use: r.in_use + 1 })
      .eq('id', 1)
      .eq('in_use', r.in_use) // optimistic CAS
      .select('in_use')
      .maybeSingle()

    if (error) return 'denied'
    if (!updated) {
      // CAS lost — another tick won. Retry.
      continue
    }

    return outcome
  }

  // CAS contention exhausted. Conservative: deny rather than over-claim.
  return 'denied'
}

/**
 * Release one Class 1 slot. Called by the runner on completion (success
 * OR failure) and by the recovery sweep when a stale dispatched/running
 * iteration is reclaimed.
 *
 * Idempotent: never decrements below 0.
 */
export async function releaseClass1Slot(): Promise<void> {
  const supabase = createServiceRoleClient()
  const maxAttempts = 5

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row } = await supabase
      .from('class_1_reserved_slots')
      .select('in_use')
      .eq('id', 1)
      .single()
    if (!row) return

    const inUse = (row as unknown as { in_use: number }).in_use
    const newInUse = Math.max(0, inUse - 1)

    const { data: updated } = await supabase
      .from('class_1_reserved_slots')
      .update({ in_use: newInUse })
      .eq('id', 1)
      .eq('in_use', inUse)
      .select('in_use')
      .maybeSingle()

    if (updated) return
    // CAS lost — retry.
  }
}

/**
 * Read current slot utilisation for telemetry / dispatcher_tick_samples.
 */
export async function readSlotsInUse(): Promise<number> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('class_1_reserved_slots')
    .select('in_use')
    .eq('id', 1)
    .single()
  return data ? (data as unknown as { in_use: number }).in_use : 0
}
