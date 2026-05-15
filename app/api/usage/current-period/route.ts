/**
 * V1.x-C.4 — GET /api/usage/current-period.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §5.
 *
 * Returns the org's current-period usage shape for the CostMeter UI
 * (deferred to V1.x-D) and for admin observation. Substrate ships in
 * V1.x-C.4; UI mounting in V1.x-D.
 *
 * Response shape:
 *   {
 *     plan: string,
 *     allocation_credits: number | null,   // null = not enforced (e.g. BYOK)
 *     usage_credits: number,
 *     period_start: string | null,         // ISO timestamp
 *     period_length_days: number,
 *     days_remaining: number | null,       // null when no period assigned
 *     byok_enabled: boolean,
 *     // V1.x-D will add: byok_dollars_spent_this_period
 *   }
 *
 * Auth: any member of the org (RLS-equivalent — caller must belong to
 * the org). The org_id is taken from a query param.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { getConfigInt } from '@/lib/config/platform-config'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest): Promise<Response> {
  const orgId = req.nextUrl.searchParams.get('org_id')
  if (!orgId) return apiError(400, 'invalid_body', 'org_id query param required')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // Verify membership — read via the user session so RLS on
  // organisation_members enforces the check naturally. Missing row →
  // not a member.
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('id')
    .eq('organisation_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) {
    return apiError(403, 'not_a_member', 'caller is not a member of the requested org')
  }

  const { data: org, error: orgErr } = await supabase
    .from('organisations')
    .select(
      'id, plan, byok_enabled, token_allocation_credits, token_usage_credits, current_period_start',
    )
    .eq('id', orgId)
    .maybeSingle()

  if (orgErr || !org) {
    return apiError(404, 'org_not_found', 'no row for the requested org_id')
  }

  // Period length from platform_config so the cost meter can show
  // "N days remaining" without doing the maths in the UI.
  let periodLengthDays = 30
  try {
    periodLengthDays = await getConfigInt('plan.period_length_days')
  } catch {
    // Defensive: fall back to 30 if the config key is missing. The
    // gate's enforcement layer logs separately.
  }

  let daysRemaining: number | null = null
  if (org.current_period_start) {
    const start = new Date(org.current_period_start)
    const end = new Date(start.getTime() + periodLengthDays * 24 * 60 * 60 * 1000)
    const msRemaining = end.getTime() - Date.now()
    daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)))
  }

  return NextResponse.json({
    plan: org.plan,
    allocation_credits:
      org.token_allocation_credits === null ? null : Number(org.token_allocation_credits),
    usage_credits: Number(org.token_usage_credits ?? 0),
    period_start: org.current_period_start,
    period_length_days: periodLengthDays,
    days_remaining: daysRemaining,
    byok_enabled: Boolean(org.byok_enabled),
  })
}
