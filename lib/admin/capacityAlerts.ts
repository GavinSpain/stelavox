import 'server-only'

/**
 * V1.x-E.2 — capacity alert evaluator.
 *
 * Source: Component Spec §17.5 §6 (capacity alerts) ·
 * wireframe_admin_dashboard_v1.html §03 (high-alert section) +
 * §05 M-145 (threshold keys).
 *
 * Three alert kinds in V1:
 *   - anthropic_itpm_high — input-tokens-per-minute utilisation above
 *     `admin.alerts.itpm_warn_pct`, sustained for
 *     `admin.alerts.itpm_sustained_minutes`. Evaluated per model
 *     against anthropic_rate_limit_samples in the window.
 *   - queue_oldest_stale — oldest queued agent_jobs row's queued_at age
 *     exceeds `admin.alerts.queue_oldest_warn_minutes`. Class 4 starvation
 *     signal (Class 1-3 should never queue this long under normal load).
 *   - failure_rate_high — failure_taxonomy_samples in the dashboard
 *     window crossed `admin.alerts.failure_rate_warn_pct` of total samples.
 *
 * Pull-evaluated at /admin page load — no separate cron evaluator in V1
 * (push notifications are V2 candidates per Director Architecture v2.4
 * §16.3). Each alert returns enough context for the wireframe high-alert
 * card to render kind + severity + message + the metric values that
 * triggered it.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { getConfigInt } from '@/lib/config/platform-config'

export type AlertSeverity = 'warn' | 'critical'

export interface CapacityAlert {
  kind: 'anthropic_itpm_high' | 'queue_oldest_stale' | 'failure_rate_high'
  severity: AlertSeverity
  message: string
  metric: string
  value: number
  threshold: number
  /** Per-model context for ITPM alerts; null otherwise. */
  model_id: string | null
  /** When the condition first held (best-effort; ITPM uses sample window start). */
  since: string | null
}

interface RateLimitSample {
  sampled_at: string
  model_id: string
  input_tokens_limit: number | null
  input_tokens_remaining: number | null
}

interface HeadroomRow {
  model_id: string
  input_tokens_limit: number | null
  input_tokens_remaining: number | null
}

interface AlertContext {
  headroomByModel: HeadroomRow[]
  queueDepthByClass: Array<{ traffic_class: number; count: number }>
  failuresInWindow: number
  totalSamplesInWindow: number
}

function utilisationPct(
  limit: number | null | undefined,
  remaining: number | null | undefined,
): number | null {
  if (limit == null || remaining == null) return null
  if (limit <= 0) return null
  const used = Math.max(0, limit - remaining)
  return (used / limit) * 100
}

/**
 * Evaluates each alert kind and returns the firing alerts. Severity is
 * 'warn' for everything in V1; 'critical' is reserved for V2 push-model
 * thresholds.
 */
export async function evaluateCapacityAlerts(
  svc: SupabaseClient,
  ctx: AlertContext,
): Promise<CapacityAlert[]> {
  const alerts: CapacityAlert[] = []

  // Read all four thresholds in parallel; tolerate missing keys (caller
  // already returns a usable dashboard if alerts evaluation fails).
  let itpmWarnPct = 75
  let itpmSustainedMin = 10
  let queueOldestWarnMin = 15
  let failureRateWarnPct = 15
  try {
    const [a, b, c, d] = await Promise.all([
      getConfigInt('admin.alerts.itpm_warn_pct'),
      getConfigInt('admin.alerts.itpm_sustained_minutes'),
      getConfigInt('admin.alerts.queue_oldest_warn_minutes'),
      getConfigInt('admin.alerts.failure_rate_warn_pct'),
    ])
    itpmWarnPct = a
    itpmSustainedMin = b
    queueOldestWarnMin = c
    failureRateWarnPct = d
  } catch {
    // Use the defaults.
  }

  // 1. anthropic_itpm_high — per-model sustained-minute check.
  // For each model in headroomByModel above the warn threshold *now*,
  // pull samples from the sustained window and require every sample to
  // also be above the threshold. A single dip below resets the timer.
  const sustainedSinceIso = new Date(
    Date.now() - itpmSustainedMin * 60 * 1000,
  ).toISOString()

  for (const row of ctx.headroomByModel) {
    const currentPct = utilisationPct(row.input_tokens_limit, row.input_tokens_remaining)
    if (currentPct === null || currentPct < itpmWarnPct) continue

    const { data: samples } = await svc
      .from('anthropic_rate_limit_samples')
      .select('sampled_at, model_id, input_tokens_limit, input_tokens_remaining')
      .eq('model_id', row.model_id)
      .gte('sampled_at', sustainedSinceIso)
      .order('sampled_at', { ascending: true })

    const windowSamples = (samples ?? []) as RateLimitSample[]
    if (windowSamples.length === 0) continue

    const allAboveThreshold = windowSamples.every((s) => {
      const p = utilisationPct(s.input_tokens_limit, s.input_tokens_remaining)
      return p !== null && p >= itpmWarnPct
    })
    if (!allAboveThreshold) continue

    alerts.push({
      kind: 'anthropic_itpm_high',
      severity: 'warn',
      message: `${row.model_id} input-tokens-per-minute headroom under ${(100 - itpmWarnPct).toFixed(0)}% for ${itpmSustainedMin}+ minutes`,
      metric: 'itpm_utilisation_pct',
      value: Math.round(currentPct),
      threshold: itpmWarnPct,
      model_id: row.model_id,
      since: windowSamples[0]?.sampled_at ?? null,
    })
  }

  // 2. queue_oldest_stale — single oldest queued row across classes.
  const { data: oldestRows } = await svc
    .from('agent_jobs')
    .select('queued_at')
    .eq('queue_status', 'queued')
    .order('queued_at', { ascending: true })
    .limit(1)

  const oldest = (oldestRows ?? [])[0] as { queued_at: string | null } | undefined
  if (oldest && oldest.queued_at) {
    const ageMs = Date.now() - new Date(oldest.queued_at).getTime()
    const ageMin = ageMs / 60_000
    if (ageMin >= queueOldestWarnMin) {
      alerts.push({
        kind: 'queue_oldest_stale',
        severity: 'warn',
        message: `Oldest queued job has waited ${Math.round(ageMin)} minutes (threshold ${queueOldestWarnMin})`,
        metric: 'queue_oldest_age_minutes',
        value: Math.round(ageMin),
        threshold: queueOldestWarnMin,
        model_id: null,
        since: oldest.queued_at,
      })
    }
  }

  // 3. failure_rate_high — derive % from the dashboard window samples.
  if (ctx.totalSamplesInWindow > 0) {
    const ratePct = (ctx.failuresInWindow / ctx.totalSamplesInWindow) * 100
    if (ratePct >= failureRateWarnPct) {
      alerts.push({
        kind: 'failure_rate_high',
        severity: 'warn',
        message: `Failure rate ${ratePct.toFixed(1)}% in window (threshold ${failureRateWarnPct}%)`,
        metric: 'failure_rate_pct',
        value: Math.round(ratePct * 10) / 10,
        threshold: failureRateWarnPct,
        model_id: null,
        since: null,
      })
    }
  }

  return alerts
}
