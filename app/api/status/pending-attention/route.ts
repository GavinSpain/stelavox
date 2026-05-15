/**
 * GET /api/status/pending-attention
 *
 * V1.x-B.1.1 — first-render hydrate for AppShellStatusIndicator.
 * Returns global counts across all documents the caller can see (RLS):
 *   - running_jobs: agent_jobs in 'running' status
 *   - queued_briefs: briefs in 'queued' status
 *   - active_briefs: briefs in 'active' status
 *   - failed_jobs: agent_jobs in 'failed' status (recent-window)
 *   - alerts: count of items needing user attention (failed jobs +
 *     proposals awaiting approval — for B.1.1 this is just failed
 *     jobs; proposal-awaiting-approval is per-document via the
 *     companion endpoint).
 *
 * V1.x-D extension — adds a `cost_meter` block carrying the caller's
 * primary-org usage for the AppShellStatusIndicator's cost segment:
 *   - byok_enabled, plan
 *   - For non-BYOK: usage_credits, allocation_credits, days_remaining
 *   - For BYOK: tokens_input, tokens_output (this-period totals)
 * Primary org resolved server-side: owner > admin > member; oldest
 * joined_at tiebreak (same rule as /settings/org-api-keys and the
 * M-138 migration).
 *
 * Realtime is the live update path (subscribed to agent_jobs / briefs);
 * this endpoint is the first-paint hydrate so the indicator doesn't
 * pop in.
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { getConfigInt } from '@/lib/config/platform-config'
import { createClient } from '@/lib/supabase/server'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // Recent-window for failed jobs — anything in the last 24 hours.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // RLS scopes each count to the caller's organisations automatically.
  const [
    { count: runningJobs },
    { count: queuedBriefs },
    { count: activeBriefs },
    { count: failedJobs },
  ] = await Promise.all([
    supabase.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    supabase.from('briefs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    supabase.from('briefs').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', dayAgo),
  ])

  // V1.x-D — resolve primary org for cost-meter compact display.
  const { data: memberships } = await supabase
    .from('organisation_members')
    .select('organisation_id, role, joined_at')
    .eq('user_id', user.id)

  type CostMeterPayload =
    | { byok_enabled: true; plan: string; tokens_input: number; tokens_output: number }
    | {
        byok_enabled: false
        plan: string
        usage_credits: number
        allocation_credits: number | null
        days_remaining: number | null
      }
    | null
  let costMeter: CostMeterPayload = null

  const sorted = (memberships ?? []).slice().sort((a, b) => {
    const rolePriority = (r: string) => (r === 'owner' ? 0 : r === 'admin' ? 1 : r === 'member' ? 2 : 3)
    const ra = rolePriority(a.role)
    const rb = rolePriority(b.role)
    if (ra !== rb) return ra - rb
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  })
  const primaryOrgId = sorted[0]?.organisation_id ?? null

  if (primaryOrgId) {
    const { data: org } = await supabase
      .from('organisations')
      .select(
        'plan, byok_enabled, token_allocation_credits, token_usage_credits, current_period_start',
      )
      .eq('id', primaryOrgId)
      .maybeSingle()
    if (org) {
      if (org.byok_enabled) {
        // For BYOK we read tokens consumed this period from agent_jobs.
        // Period start may be NULL on fresh orgs; treat as "since beginning of period_length window" fallback to 30 days.
        const periodStart =
          org.current_period_start ??
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: jobRows } = await supabase
          .from('agent_jobs')
          .select('tokens_input, tokens_output')
          .eq('organisation_id', primaryOrgId)
          .gte('completed_at', periodStart)
        const totals = (jobRows ?? []).reduce(
          (acc, r) => {
            acc.input += Number(r.tokens_input ?? 0)
            acc.output += Number(r.tokens_output ?? 0)
            return acc
          },
          { input: 0, output: 0 },
        )
        costMeter = {
          byok_enabled: true,
          plan: org.plan,
          tokens_input: totals.input,
          tokens_output: totals.output,
        }
      } else {
        let periodLengthDays = 30
        try {
          periodLengthDays = await getConfigInt('plan.period_length_days')
        } catch {
          // fallback to 30
        }
        let daysRemaining: number | null = null
        if (org.current_period_start) {
          const start = new Date(org.current_period_start)
          const end = new Date(start.getTime() + periodLengthDays * 24 * 60 * 60 * 1000)
          const msRemaining = end.getTime() - Date.now()
          daysRemaining = Math.max(0, Math.ceil(msRemaining / (24 * 60 * 60 * 1000)))
        }
        costMeter = {
          byok_enabled: false,
          plan: org.plan,
          usage_credits: Number(org.token_usage_credits ?? 0),
          allocation_credits:
            org.token_allocation_credits === null ? null : Number(org.token_allocation_credits),
          days_remaining: daysRemaining,
        }
      }
    }
  }

  return NextResponse.json({
    running_jobs: runningJobs ?? 0,
    queued_briefs: queuedBriefs ?? 0,
    active_briefs: activeBriefs ?? 0,
    failed_jobs: failedJobs ?? 0,
    alerts: failedJobs ?? 0,
    primary_org_id: primaryOrgId,
    cost_meter: costMeter,
  })
}
