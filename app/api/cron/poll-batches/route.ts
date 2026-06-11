/**
 * POST /api/cron/poll-batches — invoked by pg_cron via the
 * `batch_poll_request` channel (M-122) — invokes the TS batch poller.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.2 +
 *         §5.2.1 M-122.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> — normalised to the fleet
 * standard in Phase 9.2 (this route previously used a divergent
 * optional CRON_AUTH_TOKEN; every other /api/cron/* route uses
 * CRON_SECRET, and the M-216 pg_net transport sends one bearer for all
 * endpoints). When CRON_SECRET is unset (local dev), the gate is open —
 * same posture as dispatcher-tick.
 *
 * Invoked by: pg_cron → invoke_scheduler_endpoint('/api/cron/poll-batches')
 * via pg_net in cloud (M-216); manual POST in local dev.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { pollAllInProgressBatches } from '@/lib/scheduler/batch-poller'

export async function POST(req: NextRequest): Promise<Response> {
  const expectedToken = process.env.CRON_SECRET
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
