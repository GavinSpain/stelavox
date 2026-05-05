/**
 * Heartbeat helper.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.11 invariant I-10.
 * Build Checklist: T-19.1.
 *
 * Wraps a setInterval that calls an updater function periodically and
 * returns a stop function that callers MUST invoke (typically in a
 * try/finally) to clear the interval. Used by:
 *
 *   - The agent runner (lib/agent/runner.ts) to update
 *     agent_jobs.last_heartbeat_at every agent.heartbeat_interval_ms
 *     during LLM calls.
 *   - The workflow executor (lib/director/workflow-executor.ts) to
 *     update workflows.last_heartbeat_at on every continuation tick.
 *   - The streaming Director route (app/api/director/message/route.ts)
 *     to emit SSE :heartbeat comment lines every 10s during silence.
 */

import 'server-only'

export type HeartbeatStop = () => void

export function startHeartbeat(
  updateFn: () => void | Promise<void>,
  intervalMs: number,
): HeartbeatStop {
  // Run immediately so the first heartbeat lands without waiting one
  // interval (Phase 5 pattern: agent_jobs.started_at + last_heartbeat_at
  // both visible from real-time on transition to running).
  void Promise.resolve(updateFn()).catch(() => {
    /* swallow — heartbeat failures must not crash the runner */
  })

  const id = setInterval(() => {
    void Promise.resolve(updateFn()).catch(() => {
      /* swallow */
    })
  }, intervalMs)

  return () => clearInterval(id)
}
