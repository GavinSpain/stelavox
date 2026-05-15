import 'server-only'

/**
 * V1.x-B.2.2 — metrics samplers.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 + §7
 *         (cross-cutting metrics).
 *
 * Two writers:
 *   1. recordDispatcherTickSample — called by dispatcher.runDispatcherTick
 *      at the end of every tick. Captures per-tick counts + queue depth +
 *      virtual_clock + Class 1 slot usage + active reservation count.
 *   2. recordRouteCapacitySamples — called by a per-minute pg_cron job
 *      (or in-process scheduler in dev). Snapshots per-pool current_tokens
 *      + bucket_size + refill_rate + active concurrent calls.
 *
 * Both are best-effort — failures don't propagate to the caller. The
 * dispatcher must continue dispatching even if telemetry writes fail.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// dispatcher_tick_samples
// ---------------------------------------------------------------------------

export interface DispatcherTickSample {
  tickStartedAt: Date
  durationMs: number
  ticketsConsidered: number
  ticketsDispatched: number
  ticketsSkippedNoCapacity: number
  ticketsSkippedNoDependency: number
  ticketsSkippedWrongRoute: number
  ticketsSkippedStopRequested: number
  queueDepthClass1: number
  queueDepthClass2: number
  queueDepthClass3: number
  queueDepthClass4: number
  virtualClock: number
  class1ReservedSlotsInUse: number
  activeThrottleReservationsCount: number
}

export async function recordDispatcherTickSample(sample: DispatcherTickSample): Promise<void> {
  try {
    const supabase = createServiceRoleClient()
    await supabase.from('dispatcher_tick_samples').insert({
      tick_started_at: sample.tickStartedAt.toISOString(),
      duration_ms: sample.durationMs,
      tickets_considered: sample.ticketsConsidered,
      tickets_dispatched: sample.ticketsDispatched,
      tickets_skipped_no_capacity: sample.ticketsSkippedNoCapacity,
      tickets_skipped_no_dependency: sample.ticketsSkippedNoDependency,
      tickets_skipped_wrong_route: sample.ticketsSkippedWrongRoute,
      tickets_skipped_stop_requested: sample.ticketsSkippedStopRequested,
      queue_depth_class_1: sample.queueDepthClass1,
      queue_depth_class_2: sample.queueDepthClass2,
      queue_depth_class_3: sample.queueDepthClass3,
      queue_depth_class_4: sample.queueDepthClass4,
      virtual_clock: sample.virtualClock,
      class_1_reserved_slots_in_use: sample.class1ReservedSlotsInUse,
      active_throttle_reservations_count: sample.activeThrottleReservationsCount,
    })
  } catch (err) {
    console.error('[metrics-samplers] dispatcher_tick sample insert failed', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Convenience reader for the queue-depth + reservation-count snapshot
 * the dispatcher needs at end-of-tick. Single round trip to avoid 5
 * separate count queries.
 */
export async function readDispatcherSampleSnapshot(): Promise<{
  queueDepthClass1: number
  queueDepthClass2: number
  queueDepthClass3: number
  queueDepthClass4: number
  activeThrottleReservationsCount: number
}> {
  const supabase = createServiceRoleClient()

  const counts = await Promise.all(
    [1, 2, 3, 4].map(async (cls) => {
      const { count } = await supabase
        .from('agent_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('queue_status', 'queued')
        .eq('traffic_class', cls)
      return count ?? 0
    }),
  )

  const { count: activeReservations } = await supabase
    .from('throttle_reservations')
    .select('id', { count: 'exact', head: true })
    .is('consumed_at', null)
    .is('released_at', null)

  return {
    queueDepthClass1: counts[0],
    queueDepthClass2: counts[1],
    queueDepthClass3: counts[2],
    queueDepthClass4: counts[3],
    activeThrottleReservationsCount: activeReservations ?? 0,
  }
}

// ---------------------------------------------------------------------------
// route_capacity_samples
// ---------------------------------------------------------------------------

/**
 * Snapshot every active bucket. Called by a per-minute job (pg_cron in
 * B.2.3 M-122; for B.2.2 it's called manually by tests + an
 * opportunistic in-dispatcher path when the dispatcher hasn't sampled
 * in the last minute).
 *
 * "Active" = bucket with updated_at within the last hour, OR all
 * non-platform pools (BYOK pools that have been used recently).
 */
export async function recordRouteCapacitySamples(): Promise<{ samplesWritten: number }> {
  try {
    const supabase = createServiceRoleClient()

    // Read all buckets updated in the last hour (active set).
    const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: buckets } = await supabase
      .from('user_throttle_buckets')
      .select('pool_key, current_tokens, bucket_size, refill_rate')
      .gte('updated_at', cutoff)

    if (!buckets || buckets.length === 0) {
      // Always sample 'platform' even if it hasn't been touched.
      const { data: platform } = await supabase
        .from('user_throttle_buckets')
        .select('pool_key, current_tokens, bucket_size, refill_rate')
        .eq('pool_key', 'platform')
        .single()
      if (!platform) return { samplesWritten: 0 }
      await supabase.from('route_capacity_samples').insert({
        pool_key: 'platform',
        current_tokens: platform.current_tokens,
        bucket_size: platform.bucket_size,
        refill_rate: platform.refill_rate,
        active_concurrent_calls: 0,
      })
      return { samplesWritten: 1 }
    }

    // For each pool, count active concurrent calls (running/dispatched
    // agent_jobs whose route resolves to this pool).
    let written = 0
    for (const b of buckets) {
      const poolKey = b.pool_key as string
      let activeCalls = 0
      if (poolKey === 'platform') {
        const { count } = await supabase
          .from('agent_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('route', 'platform')
          .in('queue_status', ['dispatched', 'running'])
        activeCalls = count ?? 0
      } else if (poolKey.startsWith('byok:')) {
        // We don't currently filter agent_jobs by user-id-bucket; the
        // route is just 'byok'. For now we count all byok concurrent
        // calls into this sample. V1.x-C will refine when per-org
        // BYOK lands.
        const { count } = await supabase
          .from('agent_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('route', 'byok')
          .in('queue_status', ['dispatched', 'running'])
        activeCalls = count ?? 0
      }

      await supabase.from('route_capacity_samples').insert({
        pool_key: poolKey,
        current_tokens: b.current_tokens,
        bucket_size: b.bucket_size,
        refill_rate: b.refill_rate,
        active_concurrent_calls: activeCalls,
      })
      written++
    }

    return { samplesWritten: written }
  } catch (err) {
    console.error('[metrics-samplers] route_capacity sample insert failed', err instanceof Error ? err.message : String(err))
    return { samplesWritten: 0 }
  }
}
