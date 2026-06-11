/**
 * POST /api/cron/route-sample — records route-capacity metric samples.
 *
 * Phase 9.2 / DR-063 Option E (M-216). The V1.x-B.2 architecture drove
 * this via pg_cron → pg_notify('route_sample_request') → the TS LISTEN
 * listener → recordRouteCapacitySamples(). The listener only exists in
 * local dev; in cloud the same pg_cron job now POSTs here directly via
 * pg_net (invoke_scheduler_endpoint).
 *
 * Auth: Authorization: Bearer <CRON_SECRET> — fleet standard. When
 * CRON_SECRET is unset (local dev), the gate is open, matching
 * dispatcher-tick's posture.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { recordRouteCapacitySamples } from '@/lib/scheduler/metrics-samplers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const auth = req.headers.get('authorization') ?? ''
    const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : null
    if (supplied !== expected) {
      return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
    }
  }

  try {
    await recordRouteCapacitySamples()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'sample_failed' },
      { status: 500 },
    )
  }
}
