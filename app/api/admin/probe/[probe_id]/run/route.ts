/**
 * POST /api/admin/probe/[probe_id]/run
 *
 * V1.x-E.2 — manual trigger for synthetic probes from the admin
 * dashboard. Idempotent only at the per-row level (each call inserts
 * a new synthetic_probe_runs row with triggered_by='manual').
 *
 * Auth: PLATFORM_ADMIN_EMAILS allowlist via isPlatformAdmin. Probe
 * dispatch uses a service-role client (synthetic_probe_runs is admin-
 * scope, RLS denies user reads).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { isValidProbeId, runProbe } from '@/lib/admin/probes/runner'
import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

interface RouteContext {
  params: Promise<{ probe_id: string }>
}

export async function POST(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) return apiError(403, 'forbidden', 'admin only')

  const { probe_id: probeIdParam } = await ctx.params
  if (!isValidProbeId(probeIdParam)) {
    return apiError(400, 'invalid_probe_id', `Unknown probe_id: ${probeIdParam}`)
  }

  const svc = createServiceRoleClient()
  const { id, result } = await runProbe({
    svc,
    probeId: probeIdParam,
    triggeredBy: 'manual',
  })

  // 200 even on probe outcome='fail' — the probe ran; the *outcome* is the answer.
  return NextResponse.json({ probe_run_id: id, ...result })
}
