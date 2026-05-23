/**
 * Next.js instrumentation hook — auto-starts the scheduler LISTEN/NOTIFY
 * listener on dev server startup.
 *
 * Background (2026-05-20):
 *   lib/scheduler/listener.ts (V1.x-B.2.1 substrate) was exported but
 *   never auto-started. As a result, push-model stage triggers (M-120
 *   emits pg_notify on `dispatcher_tick_request`) had no consumer in
 *   local dev — the dispatcher only ran when something manually hit
 *   the `/api/cron/dispatcher-tick` HTTP fallback. A 2-stage Brief test
 *   stalled at stage 2 because the push-model director_iteration sat
 *   in `queued` state until manual intervention.
 *
 * What this file does:
 *   - In LOCAL DEV (NODE_ENV=development, nodejs runtime), starts the
 *     listener once per process. The listener opens a long-lived
 *     LISTEN connection on four channels (scheduler_completion,
 *     dispatcher_tick_request, batch_poll_request, route_sample_request)
 *     and fires the dispatcher / batch poller / metrics sampler when
 *     a notification arrives. Latency: <100ms vs ~30s for the pg_cron
 *     fallback.
 *   - In PRODUCTION (Vercel): does nothing. Vercel serverless functions
 *     are too short-lived to sustain a LISTEN connection (10–60s
 *     ceiling). Production relies on pg_cron + HTTP fallback at
 *     /api/cron/dispatcher-tick.
 *
 * Idempotency: a globalThis flag prevents double-start across Next.js
 * dev HMR module reloads. The handle is stashed on globalThis so a
 * future enhancement (graceful shutdown signal) can stop() it.
 *
 * DATABASE_URL: read first from env. If absent, falls back to the
 * standard Supabase local-dev connection string built from the db.port
 * value in supabase/config.toml (54332 in this worktree). The fallback
 * is a convenience — set DATABASE_URL in .env.local explicitly if your
 * setup diverges.
 */

export async function register() {
  // Only run in Node.js runtime — instrumentation also runs in Edge
  // runtime where pg client isn't available.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Production (Vercel) uses pg_cron + HTTP fallback. Long-lived LISTEN
  // connections aren't compatible with serverless function lifetimes.
  if (process.env.NODE_ENV !== 'development') return

  // HMR re-invocation guard: register() may be called more than once
  // across Next.js dev module reloads. Use a global flag so we start at
  // most one listener per Node.js process.
  const g = globalThis as {
    __stelavoxSchedulerListenerStarted?: boolean
    __stelavoxSchedulerListenerHandle?: unknown
  }
  if (g.__stelavoxSchedulerListenerStarted) return
  g.__stelavoxSchedulerListenerStarted = true

  // Resolve connection string. Standard Supabase local-dev defaults
  // are used if DATABASE_URL is unset; the supabase/config.toml db.port
  // in this worktree is 54332 (worktree port shift +10 vs the
  // stelavox baseline 54322).
  const connectionString =
    process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54332/postgres'

  try {
    const { startSchedulerListener } = await import('@/lib/scheduler/listener')
    const handle = await startSchedulerListener({
      connectionString,
      onError: (err) => {
        // Listener auto-reconnects on transient errors. Log so the
        // developer notices a sustained outage; never throw.
        console.error('[instrumentation:scheduler-listener]', err.message)
      },
    })
    g.__stelavoxSchedulerListenerHandle = handle
    console.log(
      '[instrumentation] scheduler listener started — LISTEN scheduler_completion + dispatcher_tick_request + batch_poll_request + route_sample_request',
    )
  } catch (err) {
    // Failure here is non-fatal — dev still works, just without
    // push-model responsiveness. Surface clearly so the developer can
    // diagnose (e.g. DB not running, wrong port).
    console.error(
      '[instrumentation] failed to start scheduler listener',
      err instanceof Error ? err.message : err,
    )
    // Clear the flag so a later HMR reload can retry.
    g.__stelavoxSchedulerListenerStarted = false
  }
}
