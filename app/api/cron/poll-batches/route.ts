/**
 * POST /api/cron/poll-batches — invoked by pg_cron via the
 * `batch_poll_request` channel (M-122) — invokes the TS batch poller.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.2 +
 *         §5.2.1 M-122.
 *
 * Authorisation: cron jobs run as Postgres cron.* role; they call this
 * endpoint via the listener (lib/scheduler/listener.ts subscribes to
 * pg_notify on 'batch_poll_request' and POSTs here). The route accepts
 * an optional service-role token in the Authorization header to gate
 * direct access — set `CRON_AUTH_TOKEN` env var to enable.
 *
 * Also callable from a Vercel Cron config OR Supabase Edge Function on
 * a schedule — same handler, same auth.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { pollAllInProgressBatches } from '@/lib/scheduler/batch-poller'

export async function POST(req: NextRequest): Promise<Response> {
  const expectedToken = process.env.CRON_AUTH_TOKEN
  if (expectedToken) {
    const auth = req.headers.get('authorization') ?? ''
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (supplied !== expectedToken) {
      return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
    }
  }

  try {
    const result = await pollAllInProgressBatches()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'poll_failed' },
      { status: 500 },
    )
  }
}
