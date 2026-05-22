/**
 * POST /api/admin/orchestration/reconcile
 *
 * Apollo Phase 6 admin surface — triggers reconcile_orchestration_state()
 * on demand. Same procedure that pg_cron runs every 30s, exposed for
 * "I want to run it now" debugging.
 *
 * Returns the recovery summary (counters per recovery rule).
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §12.1.
 *
 * Auth: PLATFORM_ADMIN_EMAILS allowlist.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = createServiceRoleClient()
  const { data, error } = await svc.rpc('reconcile_orchestration_state')
  if (error) {
    return NextResponse.json({ error: 'reconcile_rpc_failed', message: error.message }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    result: data,
  })
}
