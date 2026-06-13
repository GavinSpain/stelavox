/**
 * DR-121 — GET /api/admin/ops
 *
 * The Operations Summary feed: seven bands answering "is the whole system
 * healthy + what does it cost". Almost entirely SELECT over existing data
 * (agent_jobs / organisations / export_jobs / probes / subscription_events)
 * plus admin_ops_infra_health() for cron/pg_net/publication liveness.
 *
 * Admin-only (PLATFORM_ADMIN_EMAILS allowlist). Kept separate from
 * /api/admin/dashboard so that payload stays stable + ops reads cache
 * independently (decision OA-2).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { getConfigInt } from '@/lib/config/platform-config'
import { priceIdToPlan } from '@/lib/stripe/plans'

type Window = '1h' | '24h' | '7d'
function parseWindow(s: string | null): Window {
  return s === '1h' || s === '24h' || s === '7d' ? s : '24h'
}
function windowMs(w: Window): number {
  return w === '1h' ? 3_600_000 : w === '24h' ? 86_400_000 : 604_800_000
}
function yearMonth(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const PAID_PLANS = ['writer', 'author', 'pro'] as const
const PRICE_CENTS_KEY: Record<string, string> = {
  writer: 'price.writer.monthly_cents',
  author: 'price.author.monthly_cents',
  pro: 'price.pro.monthly_cents',
  byok_solo: 'price.byok_solo.monthly_cents',
}
const ALLOC_KEY: Record<string, string> = {
  trial: 'plan.trial_token_allocation_credits',
  writer: 'plan.writer_token_allocation_credits',
  author: 'plan.author_token_allocation_credits',
  pro: 'plan.pro_token_allocation_credits',
}

interface AgentJobRow {
  organisation_id: string | null
  model_id: string | null
  route: string | null
  actual_input_tokens: number | null
  actual_output_tokens: number | null
  cost_usd: number | null
  completed_at: string | null
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  if (!(await isPlatformAdmin(supabase))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceRoleClient()
  const window = parseWindow(req.nextUrl.searchParams.get('window'))
  const sinceIso = new Date(Date.now() - windowMs(window)).toISOString()
  const now = Date.now()
  const sixMonthsAgo = new Date(now - 182 * 86_400_000).toISOString()

  // ── Parallel data fetch ──────────────────────────────────────────
  const dbStart = Date.now()
  const [
    infra, orgsRes, jobsRes, jobsMoMRes, queuedRes, exportsRes,
    probesRes, subEventsRes, periodDays,
  ] = await Promise.all([
    svc.rpc('admin_ops_infra_health'),
    svc.from('organisations').select(
      'id, plan, subscription_status, token_allocation_credits, token_usage_credits, byok_enabled, stripe_price_id, created_at, current_period_start',
    ),
    svc.from('agent_jobs')
      .select('organisation_id, model_id, route, actual_input_tokens, actual_output_tokens, cost_usd, completed_at')
      .gte('completed_at', sinceIso),
    svc.from('agent_jobs')
      .select('model_id, route, cost_usd, actual_input_tokens, actual_output_tokens, completed_at')
      .eq('route', 'platform').gte('completed_at', sixMonthsAgo),
    svc.from('agent_jobs').select('traffic_class, created_at').eq('status', 'queued'),
    svc.from('export_jobs').select('format, status, file_size_bytes, created_at').gte('created_at', sinceIso),
    svc.from('synthetic_probe_runs').select('probe_id, outcome, triggered_at, duration_ms').order('triggered_at', { ascending: false }).limit(20),
    svc.from('subscription_events').select('created_at').order('created_at', { ascending: false }).limit(1),
    getConfigInt('plan.period_length_days').catch(() => 30),
  ])
  const dbLatencyMs = Date.now() - dbStart

  const orgs = (orgsRes.data ?? []) as Array<Record<string, unknown>>
  const jobs = (jobsRes.data ?? []) as AgentJobRow[]
  const infraData = (infra.data ?? {}) as Record<string, unknown>

  // ── Band 2/3 helpers — heartbeat / dependency staleness ──────────
  function ageSec(iso: unknown): number | null {
    if (typeof iso !== 'string') return null
    return Math.round((now - new Date(iso).getTime()) / 1000)
  }
  const dispatcherAge = ageSec(infraData.dispatcher_last_tick)
  const cloudOkAge = ageSec(infraData.cloud_transport_last_ok)
  const cronJobs = (infraData.cron_jobs ?? []) as Array<{ jobname: string; last_run: string | null; status: string | null }>
  const realtimePub = Number(infraData.realtime_publication_count ?? 0)

  const lastProbe = (probesRes.data ?? []) as Array<{ probe_id: string; outcome: string | null; triggered_at: string; duration_ms: number | null }>
  const anthropicProbe = lastProbe.find(p => p.probe_id === 'director_small') ?? null
  const stripeLastWebhook = (subEventsRes.data ?? [])[0]?.created_at as string | undefined

  // Anthropic-side job error rate in window.
  const windowJobs = jobs.length
  const anthropicErrors = 0 // failures are tracked in failure_taxonomy; approximated 0 here for the dep tile
  const anthropicErrorRate = windowJobs > 0 ? anthropicErrors / windowJobs : 0

  // ── Band 4 — volume & growth ─────────────────────────────────────
  const byPlan: Record<string, number> = {}
  const byStatus: Record<string, number> = {}
  let trialCount = 0
  for (const o of orgs) {
    const plan = String(o.plan ?? 'trial')
    byPlan[plan] = (byPlan[plan] ?? 0) + 1
    const st = String(o.subscription_status ?? 'none')
    byStatus[st] = (byStatus[st] ?? 0) + 1
    if (plan === 'trial') trialCount += 1
  }
  const newOrgs = orgs.filter(o => typeof o.created_at === 'string' && o.created_at >= sinceIso).length
  const activeOrgIds = new Set(jobs.map(j => j.organisation_id).filter(Boolean))
  const tokensInWindow = jobs.reduce((s, j) => s + (j.actual_input_tokens ?? 0) + (j.actual_output_tokens ?? 0), 0)

  // ── Band 5 — export & storage ────────────────────────────────────
  const exportRows = (exportsRes.data ?? []) as Array<{ format: string; status: string; file_size_bytes: number | null }>
  const exportByFormat: Record<string, number> = {}
  let exportFailed = 0, storageBytes = 0, largestBytes = 0
  for (const e of exportRows) {
    exportByFormat[e.format] = (exportByFormat[e.format] ?? 0) + 1
    if (e.status === 'failed') exportFailed += 1
    const sz = e.file_size_bytes ?? 0
    storageBytes += sz
    if (sz > largestBytes) largestBytes = sz
  }

  // ── Cadence per org (Band 6 subscriber mix) ──────────────────────
  const priceIds = [...new Set(orgs.map(o => o.stripe_price_id).filter(Boolean) as string[])]
  const cadenceByPrice = new Map<string, string>()
  await Promise.all(priceIds.map(async (pid) => {
    const r = await priceIdToPlan(pid).catch(() => null)
    if (r) cadenceByPrice.set(pid, r.cadence)
  }))

  // ── Band 6/7 — economics (group agent_jobs by org.plan + route) ──
  const planByOrg = new Map<string, string>()
  const allocByOrg = new Map<string, number>()
  const usageByOrg = new Map<string, number>()
  for (const o of orgs) {
    planByOrg.set(o.id as string, String(o.plan ?? 'trial'))
    allocByOrg.set(o.id as string, Number(o.token_allocation_credits ?? 0))
    usageByOrg.set(o.id as string, Number(o.token_usage_credits ?? 0))
  }

  // Per-cohort token + cost (platform route only).
  const cohortAgg: Record<string, { tokens: number; costUsd: number; users: Set<string> }> = {}
  function cohort(name: string) {
    return (cohortAgg[name] ??= { tokens: 0, costUsd: 0, users: new Set() })
  }
  for (const j of jobs) {
    if (j.route !== 'platform' || !j.organisation_id) continue
    const plan = planByOrg.get(j.organisation_id) ?? 'trial'
    const c = cohort(plan)
    c.tokens += (j.actual_input_tokens ?? 0) + (j.actual_output_tokens ?? 0)
    c.costUsd += j.cost_usd ?? 0
    c.users.add(j.organisation_id)
  }

  // Plan budget utilisation (avg usage/allocation over orgs on the plan).
  function avgUtil(plan: string): number {
    const planOrgs = orgs.filter(o => String(o.plan) === plan)
    if (planOrgs.length === 0) return 0
    let sum = 0, n = 0
    for (const o of planOrgs) {
      const alloc = Number(o.token_allocation_credits ?? 0)
      if (alloc > 0) { sum += Number(o.token_usage_credits ?? 0) / alloc; n += 1 }
    }
    return n > 0 ? sum / n : 0
  }

  // Revenue per cohort (monthly cents × active paid count).
  const priceCents: Record<string, number> = {}
  await Promise.all(Object.entries(PRICE_CENTS_KEY).map(async ([plan, key]) => {
    priceCents[plan] = await getConfigInt(key).catch(() => 0)
  }))
  const activePaidByPlan: Record<string, number> = {}
  for (const o of orgs) {
    const plan = String(o.plan)
    if ((PAID_PLANS as readonly string[]).includes(plan) || plan === 'byok_solo') {
      if (String(o.subscription_status) === 'active') activePaidByPlan[plan] = (activePaidByPlan[plan] ?? 0) + 1
    }
  }

  const cohorts = ['trial', ...PAID_PLANS].map((plan) => {
    const agg = cohortAgg[plan] ?? { tokens: 0, costUsd: 0, users: new Set<string>() }
    const revenue = ((activePaidByPlan[plan] ?? 0) * (priceCents[plan] ?? 0)) / 100
    return {
      plan,
      users: byPlan[plan] ?? 0,
      tokens: agg.tokens,
      cost_usd: Number(agg.costUsd.toFixed(2)),
      avg_utilisation: plan === 'trial' ? avgUtil('trial') : avgUtil(plan),
      revenue_usd: revenue,
      net_usd: Number((revenue - agg.costUsd).toFixed(2)),
    }
  })

  // Trial liability.
  const trialCost = cohortAgg['trial']?.costUsd ?? 0
  // Current-period elapsed fraction (use the earliest current_period_start as a proxy).
  const elapsedFrac = 0.5 // period pace is per-org; the UI shows the cohort marker. Placeholder midpoint.
  const trialProjected = elapsedFrac > 0 ? trialCost / elapsedFrac : trialCost

  // ── Band 7 — provider reconciliation (per model, platform route) ─
  const byModel: Record<string, { input: number; output: number; costUsd: number }> = {}
  let platformTokens = 0, platformCost = 0
  for (const j of jobs) {
    if (j.route !== 'platform') continue
    const m = j.model_id ?? 'unknown'
    const e = (byModel[m] ??= { input: 0, output: 0, costUsd: 0 })
    e.input += j.actual_input_tokens ?? 0
    e.output += j.actual_output_tokens ?? 0
    e.costUsd += j.cost_usd ?? 0
    platformTokens += (j.actual_input_tokens ?? 0) + (j.actual_output_tokens ?? 0)
    platformCost += j.cost_usd ?? 0
  }
  // MoM platform $ (6 months).
  const momMap: Record<string, number> = {}
  for (const j of (jobsMoMRes.data ?? []) as Array<{ cost_usd: number | null; completed_at: string | null }>) {
    if (!j.completed_at) continue
    const ym = yearMonth(new Date(j.completed_at))
    momMap[ym] = (momMap[ym] ?? 0) + (j.cost_usd ?? 0)
  }
  // BYOK comparison.
  let byokTokens = 0
  const byokUsers = new Set<string>()
  for (const j of jobs) {
    if (j.route === 'byok') {
      byokTokens += (j.actual_input_tokens ?? 0) + (j.actual_output_tokens ?? 0)
      if (j.organisation_id) byokUsers.add(j.organisation_id)
    }
  }
  const platformUsers = new Set(jobs.filter(j => j.route === 'platform').map(j => j.organisation_id).filter(Boolean))

  // ── Band 1 — health rollup (derive from the above) ───────────────
  const issues: Array<{ severity: 'high' | 'critical'; text: string; link: string }> = []
  if (dispatcherAge !== null && dispatcherAge > 300) {
    issues.push({ severity: 'critical', text: `Dispatcher heartbeat stale (${dispatcherAge}s)`, link: 'liveness' })
  }
  if (cloudOkAge !== null && cloudOkAge > 600) {
    issues.push({ severity: 'high', text: `Cloud dispatch transport last 200 ${Math.round(cloudOkAge / 60)}m ago`, link: 'liveness' })
  }
  if (anthropicProbe && anthropicProbe.outcome === 'fail') {
    issues.push({ severity: 'critical', text: 'Anthropic probe failing', link: 'dependencies' })
  }
  for (const c of cronJobs) {
    if (c.status && c.status !== 'succeeded' && c.status !== 'running') {
      issues.push({ severity: 'high', text: `pg_cron job ${c.jobname}: ${c.status}`, link: 'liveness' })
    }
  }
  const status = issues.some(i => i.severity === 'critical') ? 'critical'
    : issues.length > 0 ? 'degraded' : 'healthy'

  return NextResponse.json({
    window,
    health: { status, issues },
    liveness: {
      dispatcher_last_tick_age_sec: dispatcherAge,
      cloud_transport_last_ok_age_sec: cloudOkAge,
      cron_jobs: cronJobs,
      realtime_publication_count: realtimePub,
    },
    dependencies: {
      anthropic: { probe_outcome: anthropicProbe?.outcome ?? null, probe_age_sec: anthropicProbe ? ageSec(anthropicProbe.triggered_at) : null, job_error_rate: anthropicErrorRate },
      database: { reachable: true, latency_ms: dbLatencyMs },
      stripe: { last_webhook_age_sec: ageSec(stripeLastWebhook) },
    },
    volume: {
      total_orgs: orgs.length,
      by_plan: byPlan,
      by_status: byStatus,
      new_orgs: newOrgs,
      active_orgs: activeOrgIds.size,
      tokens_in_window: tokensInWindow,
    },
    storage: {
      exports_in_window: exportRows.length,
      by_format: exportByFormat,
      failed: exportFailed,
      failed_rate: exportRows.length > 0 ? exportFailed / exportRows.length : 0,
      storage_bytes: storageBytes,
      largest_bytes: largestBytes,
      per_file_limit_mb: await getConfigInt('export.max_file_size_mb').catch(() => 50),
    },
    economics: {
      cohorts,
      trial_liability: {
        cost_usd: Number(trialCost.toFixed(2)),
        projected_month_end_usd: Number(trialProjected.toFixed(2)),
        users: trialCount,
      },
      period_length_days: periodDays,
      subscriber_cadence: Object.fromEntries(
        orgs.filter(o => o.stripe_price_id).map(o => [o.id, cadenceByPrice.get(o.stripe_price_id as string) ?? 'monthly']),
      ),
    },
    reconciliation: {
      platform_tokens: platformTokens,
      platform_cost_usd: Number(platformCost.toFixed(2)),
      by_model: Object.entries(byModel).map(([model_id, v]) => ({ model_id, ...v, cost_usd: Number(v.costUsd.toFixed(2)) })),
      mom_platform_usd: Object.entries(momMap).sort().map(([month, usd]) => ({ month, usd: Number(usd.toFixed(2)) })),
      byok: {
        users: byokUsers.size,
        tokens: byokTokens,
        avg_tokens_per_user: byokUsers.size > 0 ? Math.round(byokTokens / byokUsers.size) : 0,
        platform_avg_tokens_per_user: platformUsers.size > 0 ? Math.round(platformTokens / platformUsers.size) : 0,
      },
    },
  })
}
