import 'server-only'

/**
 * V1.x-B.2.1 — pg_notify LISTEN wiring for the dispatcher.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.2 + M-109
 *         + Director Architecture v2.0 §8 (universal scheduler).
 *
 * The M-109 trigger emits pg_notify on channel 'scheduler_completion'
 * whenever an agent_jobs row reaches a terminal queue_status. This
 * module owns the LISTEN side: when a notify fires, runDispatcherTick()
 * is invoked so the dispatcher reacts in <100ms instead of waiting for
 * the next pg_cron tick.
 *
 * The two paths (LISTEN reaction + pg_cron tick) are idempotent — the
 * dispatcher's FOR UPDATE SKIP LOCKED claim ensures no double-dispatch.
 *
 * IMPORTANT: Vercel serverless functions are short-lived (max 10s in
 * hobby tier; 60s in pro). A long-running LISTEN connection is not
 * appropriate there. The B.2.1 listener substrate is designed for two
 * deployment surfaces:
 *   1. Local dev — `node scripts/run-scheduler-listener.ts` keeps a
 *      LISTEN connection alive.
 *   2. Cloud (Vercel) — pg_cron tick handles the dispatch cadence; the
 *      listener is unused in that environment. The completion latency
 *      degrades from <100ms to dispatcher_tick_interval_ms (default 1s).
 *
 * Future (B.2.4 / V1.x-E): a Supabase Edge Function could host the
 * LISTEN long-runner since Edge Functions support sustained connections
 * differently than Vercel serverless. Out of scope for B.2.1.
 */

import { Client } from 'pg'

import { runDispatcherTick } from './dispatcher'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ListenerHandle {
  /** Stop listening and close the connection. Idempotent. */
  stop: () => Promise<void>
  /** Number of completion notifications received since start. */
  getNotifyCount: () => number
}

export interface ListenerOptions {
  /** Postgres connection string. Defaults to env DATABASE_URL. */
  connectionString?: string
  /**
   * Optional override for runDispatcherTick — used in tests so the
   * listener can be exercised against a stub. Production code uses the
   * default (the real dispatcher).
   */
  onCompletion?: (payload: CompletionPayload) => Promise<void> | void
  /**
   * Optional callback invoked on any non-fatal error from the LISTEN
   * connection (e.g. transient disconnect). The listener auto-reconnects.
   * If not set, errors are logged via console.error.
   */
  onError?: (err: Error) => void
}

export interface CompletionPayload {
  agent_job_id: string
  queue_status: 'completed' | 'failed' | 'crashed' | 'cancelled' | 'skipped'
  operation_type: string
  organisation_id: string
  document_id: string | null
  director_turn_id: string | null
  iteration_number: number | null
  failure_class: 'A' | 'B' | 'C' | 'D' | 'E' | null
  completed_at: number | null
}

/**
 * Open a LISTEN 'scheduler_completion' connection. Returns a handle.
 *
 * On each notify, parses the JSONB payload and either calls the
 * supplied onCompletion callback or invokes runDispatcherTick().
 *
 * Auto-reconnects on disconnect (5s backoff). To stop, call handle.stop().
 */
export async function startSchedulerListener(opts: ListenerOptions = {}): Promise<ListenerHandle> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error('startSchedulerListener: DATABASE_URL not set and no connectionString provided')
  }

  let stopped = false
  let notifyCount = 0
  let client: Client | null = null

  const handleError = (err: Error) => {
    if (opts.onError) {
      opts.onError(err)
    } else {
      console.error('[scheduler-listener]', err.message)
    }
  }

  async function connect(): Promise<void> {
    if (stopped) return
    client = new Client({ connectionString })
    try {
      await client.connect()
    } catch (err) {
      handleError(err as Error)
      // Backoff and retry.
      setTimeout(() => {
        void connect()
      }, 5000)
      return
    }

    client.on('notification', (msg) => {
      // V1.x-B.2.3 — listen on multiple pg_notify channels:
      //   scheduler_completion       — M-109 trigger; invoke dispatcher
      //   dispatcher_tick_request    — M-122 cron stub; invoke dispatcher
      //   batch_poll_request         — M-122 cron stub; invoke batch poller
      //   route_sample_request       — M-122 cron stub; invoke metrics sampler
      if (
        msg.channel !== 'scheduler_completion' &&
        msg.channel !== 'dispatcher_tick_request' &&
        msg.channel !== 'batch_poll_request' &&
        msg.channel !== 'route_sample_request'
      ) {
        return
      }
      notifyCount++

      // Only scheduler_completion has a typed payload; the cron-stub
      // channels carry { requested_at } which we don't need to parse.
      const isCompletion = msg.channel === 'scheduler_completion'
      let payload: CompletionPayload | null = null
      if (isCompletion) {
        try {
          payload = JSON.parse(msg.payload ?? '{}') as CompletionPayload
        } catch (parseErr) {
          handleError(parseErr as Error)
          return
        }
      }

      // Fire-and-forget invocation. Errors caught here, not surfaced
      // to the caller (a single bad tick should not stop the listener).
      Promise.resolve()
        .then(async () => {
          if (msg.channel === 'batch_poll_request') {
            const { pollAllInProgressBatches } = await import('./batch-poller')
            await pollAllInProgressBatches()
            return
          }
          if (msg.channel === 'route_sample_request') {
            const { recordRouteCapacitySamples } = await import('./metrics-samplers')
            await recordRouteCapacitySamples()
            return
          }
          // scheduler_completion or dispatcher_tick_request → dispatch tick.
          if (isCompletion && opts.onCompletion) {
            return opts.onCompletion(payload!)
          }
          await runDispatcherTick()
        })
        .catch((err) => handleError(err as Error))
    })

    client.on('error', (err: Error) => {
      handleError(err)
      // Disconnect + reconnect.
      void client?.end().catch(() => {})
      setTimeout(() => {
        void connect()
      }, 5000)
    })

    try {
      await client.query('LISTEN scheduler_completion')
      await client.query('LISTEN dispatcher_tick_request')
      await client.query('LISTEN batch_poll_request')
      await client.query('LISTEN route_sample_request')
    } catch (err) {
      handleError(err as Error)
    }
  }

  await connect()

  return {
    stop: async () => {
      stopped = true
      if (client) {
        try {
          await client.query('UNLISTEN scheduler_completion').catch(() => {})
          await client.query('UNLISTEN dispatcher_tick_request').catch(() => {})
          await client.query('UNLISTEN batch_poll_request').catch(() => {})
          await client.query('UNLISTEN route_sample_request').catch(() => {})
          await client.end().catch(() => {})
        } finally {
          client = null
        }
      }
    },
    getNotifyCount: () => notifyCount,
  }
}
