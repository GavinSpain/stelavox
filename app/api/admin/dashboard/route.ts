/**
 * GET /api/admin/dashboard?window=1h|24h|7d
 *
 * V1.x-E.2 — single endpoint that returns every section the admin
 * dashboard renders. One round-trip simplifies the page; admin views
 * are infrequent so coalescing is fine.
 *
 * Sections returned:
 *   - live_counters: { active_turns, running_jobs, queued_jobs,
 *                     failures_24h, failure_breakdown }
 *   - queue_depth: per-traffic-class current snapshot
 *   - anthropic_headroom: most-recent rate-limit row per model
 *   - dispatch_rate_series: per-2min buckets over the last hour
 *   - failures_by_class: counts per failure_class in the window +
 *                       auto-recovery rate
 *   - spend_leaders: { top_orgs_by_credits, by_model_credits }
 *   - capacity_alerts: array of evaluated alerts (see lib/admin/
 *                      capacityAlerts.ts)
 *   - probes: most-recent run per probe_id
 *   - audit_log_recent: newest 50 audit_log rows within the window
 *     (Phase 9.1 / DR-096; wireframe_admin_audit_log_v1.html D1-D6).
 *     ?audit_before=<created_at ISO> pages the next 50 (older rows).
 *
 * Auth: PLATFORM_ADMIN_EMAILS allowlist via isPlatformAdmin. Reads
 * use a service-role client to bypass RLS (admin views all orgs by
 * design).
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { evaluateCapacityAlerts } from '@/lib/admin/capacityAlerts'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { apiError } from '@/lib/director/route-helpers'
import { getConfigInt } from '@/lib/config/platform-config'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

type Window = '1h' | '24h' | '7d'

function parseWindow(s: string | null): Window {
  if (s === '24h' || s === '7d') return s
  return '1h'
}

function windowMs(w: Window): number {
  return w === '7d' ? 7 * 24 * 60 * 60 * 1000 : w === '24h' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000
}

export async function GET(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) return apiError(403, 'forbidden', 'admin only')

  const window = parseWindow(req.nextUrl.searchParams.get('window'))
  const sinceIso = new Date(Date.now() - windowMs(window)).toISOString()
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  // DR-096 wireframe D2 + annotation 5 — cursor pagination for the
  // audit-log section's "Load more": rows strictly older than this
  // created_at ISO timestamp. Absent = first page (newest 50).
  const auditBefore = req.nextUrl.searchParams.get('audit_before')

  // Use service-role for cross-org reads — admin views are not RLS-scoped.
  const svc = createServiceRoleClient()

  const [
    { count: activeTurns },
    { count: runningJobs },
    { count: queuedJobs },
    { count: failures24h },
    queueDepthByClass,
    failureBreakdown,
    headroomByModel,
    dispatchRateSeries,
    failuresInWindow,
    topOrgsByCredits,
    byModelCredits,
    probes,
    autoRecovery,
    auditRows,
    auditWindowCount,
    orgNames,
  ] = await Promise.all([
    svc.from('director_turns').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
    svc.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    svc.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('queue_status', 'queued'),
    svc.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', dayAgoIso),
    svc
      .from('agent_jobs')
      .select('traffic_class')
      .eq('queue_status', 'queued'),
    svc
      .from('agent_jobs')
      .select('failure_class')
      .eq('status', 'failed')
      .gte('created_at', dayAgoIso),
    svc
      .from('anthropic_rate_limit_samples')
      .select('model_id, sampled_at, requests_limit, requests_remaining, input_tokens_limit, input_tokens_remaining, output_tokens_limit, output_tokens_remaining')
      .order('sampled_at', { ascending: false })
      .limit(60),
    svc
      .from('metrics_minute_buckets')
      .select('bucket_started_at, dispatch_rate')
      .gte('bucket_started_at', sinceIso)
      .order('bucket_started_at', { ascending: true }),
    svc
      .from('failure_taxonomy_samples')
      .select('failure_class, occurred_at')
      .gte('occurred_at', sinceIso),
    svc
      .from('organisations')
      .select('id, name, plan, token_usage_credits, token_allocation_credits')
      .order('token_usage_credits', { ascending: false })
      .limit(5),
    svc
      .from('agent_jobs')
      .select('model_id, cost_credits')
      .gte('completed_at', sinceIso)
      .not('cost_credits', 'is', null),
    svc
      .from('synthetic_probe_runs')
      .select('probe_id, triggered_at, completed_at, outcome, duration_ms, failure_class')
      .order('triggered_at', { ascending: false })
      .limit(40),
    svc
      .from('failure_taxonomy_samples')
      .select('auto_recovered')
      .gte('occurred_at', sinceIso),
    // DR-096 — audit-log section. All severities fetched (the severity
    // chips filter client-side so counts stay honest per wireframe D3).
    (() => {
      let q = svc
        .from('audit_log')
        .select('id, event_type, severity, organisation_id, user_id, document_id, conversation_id, node_id, metadata, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false })
        .limit(50)
      if (auditBefore) q = q.lt('created_at', auditBefore)
      return q
    })(),
    // Window total (unfiltered count for the section header per
    // wireframe annotation 1).
    svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', sinceIso),
    // Org names for the audit rows' org column — small lookup; the
    // join is done client-side from this map.
    svc.from('organisations').select('id, name').limit(200),
  ])

  // Derive queue-depth-by-class.
  const queueByClass = new Map<number, number>([[1, 0], [2, 0], [3, 0], [4, 0]])
  for (const row of (queueDepthByClass.data ?? []) as Array<{ traffic_class: number }>) {
    queueByClass.set(row.traffic_class, (queueByClass.get(row.traffic_class) ?? 0) + 1)
  }

  // Derive failure breakdown for headline counter sub-line.
  const failBreakdown = new Map<string, number>()
  for (const row of (failureBreakdown.data ?? []) as Array<{ failure_class: string | null }>) {
    const cls = row.failure_class ?? 'unknown'
    failBreakdown.set(cls, (failBreakdown.get(cls) ?? 0) + 1)
  }

  // Most-recent headroom row per model (the SDK doesn't have DISTINCT ON;
  // we collapse client-side from the ordered fetch).
  type HeadroomRow = {
    model_id: string
    sampled_at: string
    requests_limit: number | null
    requests_remaining: number | null
    input_tokens_limit: number | null
    input_tokens_remaining: number | null
    output_tokens_limit: number | null
    output_tokens_remaining: number | null
  }
  const headroomMap = new Map<string, HeadroomRow>()
  for (const row of (headroomByModel.data ?? []) as HeadroomRow[]) {
    if (!headroomMap.has(row.model_id)) {
      headroomMap.set(row.model_id, row)
    }
  }

  // Dispatch rate series — bucket to ~2 min for 1h window; raw for shorter.
  const dispatchSeries = ((dispatchRateSeries.data ?? []) as Array<{
    bucket_started_at: string
    dispatch_rate: number | null
  }>).map((r) => ({
    t: r.bucket_started_at,
    rate: r.dispatch_rate ?? 0,
  }))

  // Failures by class in window.
  const failByClass = new Map<string, number>([
    ['A', 0],
    ['B', 0],
    ['C', 0],
    ['D', 0],
    ['E', 0],
  ])
  for (const row of (failuresInWindow.data ?? []) as Array<{ failure_class: string }>) {
    if (failByClass.has(row.failure_class)) {
      failByClass.set(row.failure_class, (failByClass.get(row.failure_class) ?? 0) + 1)
    }
  }

  // Auto-recovery rate.
  const recoverySamples = (autoRecovery.data ?? []) as Array<{ auto_recovered: boolean | null }>
  const recoveredCount = recoverySamples.filter((r) => r.auto_recovered === true).length
  const totalSamples = recoverySamples.length
  const autoRecoveryRate = totalSamples > 0 ? recoveredCount / totalSamples : null

  // Spend leaders — top orgs filter out NULL allocations + zero usage.
  const orgs = ((topOrgsByCredits.data ?? []) as Array<{
    id: string
    name: string
    plan: string
    token_usage_credits: number | null
    token_allocation_credits: number | null
  }>)
    .filter((o) => Number(o.token_usage_credits ?? 0) > 0)
    .map((o) => ({
      org_id: o.id,
      name: o.name,
      plan: o.plan,
      usage_credits: Number(o.token_usage_credits ?? 0),
      allocation_credits:
        o.token_allocation_credits === null ? null : Number(o.token_allocation_credits),
    }))

  // By-model credits sum in window.
  const modelCredits = new Map<string, number>()
  for (const row of (byModelCredits.data ?? []) as Array<{
    model_id: string | null
    cost_credits: number | null
  }>) {
    const m = row.model_id ?? 'unknown'
    modelCredits.set(m, (modelCredits.get(m) ?? 0) + Number(row.cost_credits ?? 0))
  }

  // Probes — most-recent per probe_id from the ordered fetch.
  type ProbeRow = {
    probe_id: string
    triggered_at: string
    completed_at: string | null
    outcome: string | null
    duration_ms: number | null
    failure_class: string | null
  }
  const probesByid = new Map<string, ProbeRow>()
  for (const row of (probes.data ?? []) as ProbeRow[]) {
    if (!probesByid.has(row.probe_id)) {
      probesByid.set(row.probe_id, row)
    }
  }

  // Org-name lookup for audit rows.
  const orgNameById = new Map<string, string>()
  for (const o of (orgNames.data ?? []) as Array<{ id: string; name: string }>) {
    orgNameById.set(o.id, o.name)
  }

  // Capacity-alert evaluation.
  const alerts = await evaluateCapacityAlerts(svc, {
    headroomByModel: Array.from(headroomMap.values()).map((r) => ({
      model_id: r.model_id,
      input_tokens_limit: r.input_tokens_limit,
      input_tokens_remaining: r.input_tokens_remaining,
    })),
    queueDepthByClass: Array.from(queueByClass.entries()).map(([cls, count]) => ({
      traffic_class: cls,
      count,
    })),
    failuresInWindow: (failuresInWindow.data ?? []).length,
    totalSamplesInWindow: totalSamples,
  })

  // Period length for context.
  let periodLengthDays = 30
  try {
    periodLengthDays = await getConfigInt('plan.period_length_days')
  } catch {
    // fallback
  }

  return NextResponse.json({
    window,
    period_length_days: periodLengthDays,
    live_counters: {
      active_turns: activeTurns ?? 0,
      running_jobs: runningJobs ?? 0,
      queued_jobs: queuedJobs ?? 0,
      failures_24h: failures24h ?? 0,
      failure_breakdown: Object.fromEntries(failBreakdown),
    },
    queue_depth: Array.from(queueByClass.entries()).map(([cls, count]) => ({
      traffic_class: cls,
      count,
    })),
    anthropic_headroom: Array.from(headroomMap.values()),
    dispatch_rate_series: dispatchSeries,
    failures_by_class: Array.from(failByClass.entries()).map(([cls, count]) => ({
      failure_class: cls,
      count,
    })),
    auto_recovery_rate: autoRecoveryRate,
    spend_leaders: {
      top_orgs: orgs,
      by_model: Array.from(modelCredits.entries())
        .map(([model_id, credits]) => ({ model_id, credits }))
        .sort((a, b) => b.credits - a.credits),
    },
    capacity_alerts: alerts,
    probes: Array.from(probesByid.values()),
    audit_log_recent: {
      window_total: auditWindowCount.count ?? 0,
      rows: ((auditRows.data ?? []) as Array<{
        id: string
        event_type: string
        severity: string
        organisation_id: string | null
        user_id: string | null
        document_id: string | null
        conversation_id: string | null
        node_id: string | null
        metadata: Record<string, unknown> | null
        created_at: string
      }>).map((r) => ({
        ...r,
        organisation_name:
          orgNameById.get(r.organisation_id ?? '') ?? null,
      })),
    },
  })
}
