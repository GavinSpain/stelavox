/**
 * POST /api/cron/period-rollover — Vercel-Cron-driven recovery path for
 * the org token-usage period rollover.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §5.
 *
 * Calls the M-141 SECURITY DEFINER function `rollover_org_periods()`.
 *
 * Auth: Authorization: Bearer <CRON_SECRET>. Same scheme as the other
 * Vercel-Cron-driven routes (director-recovery, poll-batches).
 *
 * Local pg_cron runs the same function on a daily schedule at 03:00 UTC
 * (M-141). The Next.js route is the platform's recovery path: cloud
 * environments where the local pg_cron is disabled, or one-off manual
 * triggers from an admin shell. The two paths are idempotent — running
 * both on the same day is safe (the WHERE clause filters orgs whose
 * period_start has actually elapsed, and the rolled-over rows are
 * skipped on subsequent invocations within the same period).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { createServiceRoleClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest): Promise<Response> {
  const authHeader = req.headers.get('authorization')
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'cron_secret_not_configured' },
      { status: 500 },
    )
  }
  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'unauthorised' }, { status: 401 })
  }

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('rollover_org_periods')

  if (error) {
    return NextResponse.json(
      { error: 'rpc_failed', message: error.message },
      { status: 500 },
    )
  }

  return NextResponse.json(data ?? { rolled_over: 0 })
}
