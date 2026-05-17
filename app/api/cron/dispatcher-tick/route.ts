/**
 * POST /api/cron/dispatcher-tick — Vercel-Cron-driven fallback to the
 * V1.x-B.2 pg_cron `dispatcher_tick_request` schedule.
 *
 * The V1.x-B.2 architecture uses pg_cron + pg_notify('dispatcher_tick_request')
 * + a TS listener subscribing to that channel to drive the WFQ scheduler.
 * The listener (`lib/scheduler/listener.ts`) is server-only and was never
 * auto-wired into either local-dev (no Next.js instrumentation hook) or
 * Vercel deploy (no boot path). Without it, every queued agent_job sits
 * forever — including the Stage 2 director_iteration that the V1.x-B.2
 * push-model trigger inserts.
 *
 * This route gives both environments a concrete dispatch path:
 *   • Vercel-Cron config (every minute) → POST here → runDispatcherTick()
 *   • Local-dev manual trigger → POST here with the CRON_SECRET → one tick
 *
 * Either path can complement the listener once it's properly wired; the
 * dispatcher's CAS-on-claim and reservation lifecycle make double-dispatch
 * safe.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Same scheme as the other
 * /api/cron/* routes.
 *
 * Body shape: optional `{ max_ticks?: number, intra_tick_delay_ms?: number }`
 * to run a small burst of ticks in one HTTP request (useful when the cron
 * runs every minute but the dispatcher tick cadence is 1s — request 60
 * ticks at 1s intervals).
 *
 * Responds 200 with each tick's result. A tick that dispatches nothing
 * is a successful tick (returns `dispatched: 0`).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { runDispatcherTick } from '@/lib/scheduler/dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Vercel function timeout. The default 300s allows a full minute of
// 1s-interval ticks plus the per-tick dispatch work.
export const maxDuration = 300

interface RequestBody {
  max_ticks?: number
  intra_tick_delay_ms?: number
}

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET
  // Local dev: allow the route without CRON_SECRET if NODE_ENV !== production.
  if (process.env.NODE_ENV === 'production' && !expected) {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 500 })
  }
  if (expected) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${expected}`) {
      return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
    }
  }

  let body: RequestBody = {}
  if (req.headers.get('content-type')?.includes('application/json')) {
    try { body = await req.json() as RequestBody } catch { /* empty body is fine */ }
  }

  const maxTicks = Math.max(1, Math.min(120, body.max_ticks ?? 1))
  const intraDelay = Math.max(0, Math.min(5000, body.intra_tick_delay_ms ?? 0))

  const results: Array<{ tick: number; dispatched: number; skipped: number; duration_ms: number }> = []

  for (let i = 0; i < maxTicks; i++) {
    const t0 = Date.now()
    let result
    try {
      result = await runDispatcherTick()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json(
        { error: 'dispatcher_tick_failed', tick: i + 1, prior_results: results, message: msg },
        { status: 500 },
      )
    }
    results.push({
      tick: i + 1,
      dispatched: result.ticketsDispatched,
      skipped:
        result.ticketsSkippedNoCapacity +
        result.ticketsSkippedNoDependency +
        result.ticketsSkippedWrongRoute +
        result.ticketsSkippedStopRequested,
      duration_ms: Date.now() - t0,
    })
    if (i < maxTicks - 1 && intraDelay > 0) {
      await new Promise((r) => setTimeout(r, intraDelay))
    }
  }

  return NextResponse.json({
    ok: true,
    ticks: maxTicks,
    total_dispatched: results.reduce((s, r) => s + r.dispatched, 0),
    total_skipped: results.reduce((s, r) => s + r.skipped, 0),
    results,
  })
}
