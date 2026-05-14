import 'server-only'

/**
 * V1.x-B.1.1 session 3a — TS wrappers for the M-099 recovery sweep
 * procedures.
 *
 * pg_cron invokes both procedures every 30s automatically (M-102
 * schedule). These wrappers are for:
 *   - direct invocation in tests + recovery paths
 *   - in-process invocation by lib/iteration runner before re-enqueue
 *     decisions (session 3b territory)
 *
 * Two procedures:
 *   - sweepInterruptedIterations() — heartbeat-based detection of
 *     stale director_iterations rows (M-093). Marks status='interrupted'
 *     + failure_class='B'. The lib/iteration runner (session 3b) then
 *     re-enqueues those iterations idempotently.
 *   - The throttle reservation sweep lives in reservation.ts since it's
 *     more naturally co-located with reserve/consume/release.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

const DEFAULT_STALE_THRESHOLD_SECONDS = 60

async function readStaleThreshold(): Promise<number> {
  // The M-099 procedure parameter is in seconds; the platform_config
  // key 'scheduler.recovery_sweep_interval_ms' is in ms but represents
  // the SWEEP cadence, not the stale threshold itself. The threshold
  // is fixed at 60s per H-17 / Director Arch §10.2 reasoning; expose
  // an override here for tests.
  const v = await getConfig<number>('scheduler.iteration_stale_threshold_seconds')
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : DEFAULT_STALE_THRESHOLD_SECONDS
}

/**
 * Detect stale-heartbeat running iterations and mark them
 * 'interrupted' (failure_class='B'). Returns the count swept.
 *
 * Idempotent — the SQL UPDATE WHERE clause excludes already-interrupted
 * rows. Safe to invoke from multiple sources.
 */
export async function sweepInterruptedIterations(thresholdSecondsOverride?: number): Promise<{ swept: number }> {
  const threshold = thresholdSecondsOverride ?? (await readStaleThreshold())
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('scheduler_sweep_interrupted_iterations', {
    p_stale_threshold_seconds: threshold,
  })
  if (error) throw new Error(`sweepInterruptedIterations() failed: ${error.message}`)
  return { swept: typeof data === 'number' ? data : Number(data ?? 0) }
}
