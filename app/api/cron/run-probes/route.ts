/**
 * POST /api/cron/run-probes — Vercel-Cron-driven fallback to the
 * V1.x-F.3 pg_cron schedule (M-148).
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §2 M-148.
 *
 * Runs all three V1.x probes sequentially with triggered_by='cron'.
 * Cloud environments where local pg_cron is disabled — or one-off
 * manual triggers from an admin shell — use this route as the canonical
 * cron path. The two trigger paths (pg_cron pg_notify → TS listener,
 * and this HTTP route) are independently idempotent: each probe run is
 * a separate synthetic_probe_runs row.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Same scheme as
 * /api/cron/period-rollover + /api/cron/poll-batches.
 *
 * Responds 200 with the three probe outcomes regardless of pass/fail —
 * a probe outcome='fail' is the answer (probe ran), not a route error.
 * Returns 500 only when the route itself fails (e.g. service-role
 * client unavailable).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isValidProbeId, runProbe, type ProbeId } from '@/lib/admin/probes/runner'
import { createServiceRoleClient } from '@/lib/supabase/service'

const ALL_PROBES: ReadonlyArray<ProbeId> = ['director_small', 'workflow_expand', 'refine_accept']

export async function POST(req: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'cron_secret_not_configured' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  // Optional `?probe_id=...` query param to run a single probe;
  // omitting runs all three.
  const requested = req.nextUrl.searchParams.get('probe_id')
  const probeIds: ReadonlyArray<ProbeId> = (() => {
    if (!requested) return ALL_PROBES
    if (!isValidProbeId(requested)) return []
    return [requested]
  })()

  if (probeIds.length === 0) {
    return NextResponse.json({ error: 'invalid_probe_id' }, { status: 400 })
  }

  const svc = createServiceRoleClient()
  const results: Array<{ probe_id: ProbeId; probe_run_id: number; outcome: string }> = []
  for (const probeId of probeIds) {
    const { id, result } = await runProbe({
      svc,
      probeId,
      triggeredBy: 'cron',
    })
    results.push({ probe_id: probeId, probe_run_id: id, outcome: result.outcome })
  }

  return NextResponse.json({ ran: results.length, results })
}
