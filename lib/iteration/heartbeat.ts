import 'server-only'

/**
 * V1.x-B.1.1 session 3b — iteration heartbeat writer.
 *
 * Writes director_iterations.last_heartbeat_at on a configurable cadence
 * inside a running iteration. The recovery sweep (M-099 +
 * scheduler_sweep_interrupted_iterations) marks running iterations as
 * 'interrupted' when last_heartbeat_at falls behind a threshold (default 60s).
 *
 * Cadence read from director.iteration_heartbeat_interval_seconds (M-101 default 10s).
 *
 * Two surfaces:
 *   - startHeartbeat(turnId, iterationNumber) — fire-and-forget setInterval
 *     that runs until stopHeartbeat is called. Use within long-running
 *     iteration code paths.
 *   - heartbeatOnce(turnId, iterationNumber) — single write. Use when the
 *     caller manages its own loop (e.g. reading a stream chunk-by-chunk).
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

const DEFAULT_INTERVAL_SECONDS = 10

export interface HeartbeatHandle {
  stop: () => void
}

/**
 * Single heartbeat write. Idempotent — overwrites last_heartbeat_at.
 * Best-effort: failures are logged + swallowed (don't disrupt the
 * caller's primary work).
 */
export async function heartbeatOnce(turnId: string, iterationNumber: number): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('director_iterations')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('turn_id', turnId)
    .eq('iteration_number', iterationNumber)
    .eq('status', 'running')  // only heartbeat running iterations
  if (error) {
    console.warn('[iteration/heartbeat] heartbeatOnce failed:', error.message, { turnId, iterationNumber })
  }
}

/**
 * Start a fire-and-forget heartbeat interval. Returns a handle whose
 * stop() halts the interval. Cadence read from platform_config; falls
 * back to DEFAULT_INTERVAL_SECONDS.
 *
 * Caller MUST call stop() when the iteration ends — typically in a
 * try/finally around the LLM call.
 */
export async function startHeartbeat(turnId: string, iterationNumber: number): Promise<HeartbeatHandle> {
  const intervalSeconds = (await getConfig<number>('director.iteration_heartbeat_interval_seconds')) ?? DEFAULT_INTERVAL_SECONDS
  const intervalMs = Math.max(1, intervalSeconds) * 1000

  // Initial heartbeat right away so the row reflects "running" state immediately.
  await heartbeatOnce(turnId, iterationNumber)

  const id = setInterval(() => {
    void heartbeatOnce(turnId, iterationNumber)
  }, intervalMs)

  return {
    stop: () => clearInterval(id),
  }
}
