'use client'

/**
 * V1.x-D — CostMeter full form.
 *
 * Source: Component Spec §17.6 · wireframe_cost_meter_v1.html §02 / §03.
 *
 * Renders at /settings/usage. Two variants per org type:
 *
 *   - Non-BYOK (Platform tier): primary card with plan name + days
 *     remaining + percent used + usage bar + denominator. Soft upgrade
 *     CTA appears above 60% usage. Empty state shows 0% / fresh-period
 *     copy.
 *
 *   - BYOK: primary card with plan name + key status (last_four +
 *     validated time) + token table (in / out / total). Empty state
 *     shows centred "No LLM activity yet this period" copy. No dollar
 *     surface (provider-neutral, locked 2026-05-17).
 *
 * Data source: `GET /api/usage/current-period?org_id=<id>` (V1.x-C.4).
 * Realtime-subscribed to the organisations row so usage_credits +
 * byok_api_key_last_validated_at refresh as events fire.
 */

import { useCallback, useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'

interface CurrentPeriodPayload {
  plan: string
  allocation_credits: number | null
  usage_credits: number
  period_start: string | null
  period_length_days: number
  days_remaining: number | null
  byok_enabled: boolean
}

interface ByokKeyStatusPayload {
  present: boolean
  byok_enabled: boolean
  plan: string
  last_four: string | null
  last_validated_at: string | null
}

interface ByokTokenTotals {
  input: number
  output: number
}

const SOFT_CTA_THRESHOLD = 60

export function CostMeterFull({ orgId }: { orgId: string }) {
  const [period, setPeriod] = useState<CurrentPeriodPayload | null>(null)
  const [byokStatus, setByokStatus] = useState<ByokKeyStatusPayload | null>(null)
  const [byokTokens, setByokTokens] = useState<ByokTokenTotals | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const periodRes = await fetch(
        `/api/usage/current-period?org_id=${encodeURIComponent(orgId)}`,
        { cache: 'no-store' },
      )
      if (!periodRes.ok) {
        setError(`Could not load usage: ${periodRes.status}`)
        return
      }
      const periodBody = (await periodRes.json()) as CurrentPeriodPayload
      setPeriod(periodBody)

      if (periodBody.byok_enabled) {
        // Pull org key status for header line; ignore failure (header
        // degrades gracefully).
        const keyRes = await fetch(
          `/api/org/anthropic-key?org_id=${encodeURIComponent(orgId)}`,
          { cache: 'no-store' },
        )
        if (keyRes.ok) {
          const keyBody = (await keyRes.json()) as ByokKeyStatusPayload
          setByokStatus(keyBody)
        }
        // Pull this-period token totals direct from agent_jobs (sum of
        // tokens_input/output filtered to org + period). Client-side
        // direct read via RLS-scoped supabase.
        const supabase = createClient()
        const since = periodBody.period_start ??
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
        const { data: rows } = await supabase
          .from('agent_jobs')
          .select('tokens_input, tokens_output')
          .eq('organisation_id', orgId)
          .gte('completed_at', since)
        const totals = (rows ?? []).reduce(
          (acc, r) => {
            acc.input += Number(r.tokens_input ?? 0)
            acc.output += Number(r.tokens_output ?? 0)
            return acc
          },
          { input: 0, output: 0 },
        )
        setByokTokens(totals)
      }
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Realtime: refresh on organisations row changes for this org.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`cost-meter-${orgId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'organisations', filter: `id=eq.${orgId}` },
        () => void refresh(),
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [orgId, refresh])

  if (loading && !period) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 16 }}>
        Loading usage…
      </div>
    )
  }
  if (error) {
    return (
      <div
        role="alert"
        data-testid="cost-meter-error"
        style={{
          padding: '8px 12px',
          background: 'rgba(176,60,60,0.08)',
          border: '1px solid rgba(176,60,60,0.25)',
          borderRadius: 4,
          fontSize: 12,
          color: 'var(--color-text-primary)',
        }}
      >
        {error}
      </div>
    )
  }
  if (!period) return null

  if (period.byok_enabled) {
    return <ByokView period={period} status={byokStatus} totals={byokTokens} />
  }
  return <PlatformView period={period} />
}

// ---------------------------------------------------------------------------
// Non-BYOK / Platform view
// ---------------------------------------------------------------------------

function PlatformView({ period }: { period: CurrentPeriodPayload }) {
  const allocation = period.allocation_credits ?? 0
  const usage = period.usage_credits
  const pct = allocation > 0 ? Math.min(100, Math.round((usage / allocation) * 100)) : 0
  const isCap = pct >= 100
  const isWarn = pct >= 80 && !isCap
  const fillColour = isCap
    ? 'var(--color-error)'
    : isWarn
      ? 'var(--color-warning)'
      : 'var(--color-text-secondary)'
  const showSoftCta = pct >= SOFT_CTA_THRESHOLD && pct < 100

  const planLabel = period.plan
    ? period.plan.charAt(0).toUpperCase() + period.plan.slice(1)
    : 'Plan'

  return (
    <section
      data-testid="cost-meter-full"
      data-user-type="platform"
      data-usage-pct={pct}
      style={cardStyle}
    >
      <div style={titleRow}>
        <div style={titleStyle}>{planLabel} plan</div>
        <div style={subStyle}>
          {period.days_remaining !== null
            ? `Renews in ${period.days_remaining} day${period.days_remaining === 1 ? '' : 's'}`
            : 'Period not yet assigned'}
        </div>
      </div>
      <div style={statBigStyle} data-testid="cost-meter-pct">
        {pct}% used
      </div>
      <div style={usageBar}>
        <div
          data-testid="usage-fill"
          data-cap={isCap || undefined}
          data-warn={isWarn || undefined}
          style={{
            height: '100%',
            width: `${pct}%`,
            background: fillColour,
            opacity: isCap || isWarn ? 1 : 0.5,
          }}
        />
      </div>
      <div style={usageNumeric}>
        {usage.toLocaleString()} of {allocation > 0 ? allocation.toLocaleString() : '—'} credits
      </div>
      {showSoftCta ? <SoftUpgradeCta plan={period.plan} /> : null}
    </section>
  )
}

function SoftUpgradeCta({ plan }: { plan: string }) {
  const recommendation =
    plan === 'trial'
      ? 'Upgrade to Writer for 1M credits per period.'
      : plan === 'writer'
        ? 'Upgrade to Author for 4M credits per period.'
        : plan === 'author'
          ? 'Upgrade to Pro for 16M credits per period.'
          : 'See your plan options.'
  return (
    <div data-testid="soft-upgrade-cta" style={ctaSoft}>
      <div style={ctaTitle}>Need more headroom?</div>
      <div>
        {recommendation}{' '}
        <a href="/settings/plan" style={ctaLink}>
          View plans →
        </a>{' '}
        <span style={ctaNote}>read-only in V1</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BYOK view
// ---------------------------------------------------------------------------

function ByokView({
  period,
  status,
  totals,
}: {
  period: CurrentPeriodPayload
  status: ByokKeyStatusPayload | null
  totals: ByokTokenTotals | null
}) {
  const planLabel = formatPlanLabel(period.plan)
  const hasActivity = totals !== null && (totals.input > 0 || totals.output > 0)

  let subRow: string
  if (status?.present && status.last_four && status.last_validated_at) {
    subRow = `Provider key validated ${relativeTime(status.last_validated_at)} · …${status.last_four}`
  } else if (status?.byok_enabled && !status.present) {
    subRow = 'BYOK enabled · no key uploaded yet'
  } else {
    subRow = 'Provider key on file'
  }

  return (
    <section
      data-testid="cost-meter-full"
      data-user-type="byok"
      style={cardStyle}
    >
      <div style={titleRow}>
        <div style={titleStyle}>{planLabel}</div>
        <div style={subStyle}>{subRow}</div>
      </div>
      {!hasActivity ? (
        <ByokEmptyState />
      ) : (
        <div style={tokenTable} data-testid="cost-meter-tokens">
          <div style={tkLabel}>Tokens in</div>
          <div style={tkValue}>{(totals?.input ?? 0).toLocaleString()}</div>
          <div style={tkLabel}>Tokens out</div>
          <div style={tkValue}>{(totals?.output ?? 0).toLocaleString()}</div>
          <div style={{ ...tkLabel, ...tkTotal }}>Total tokens</div>
          <div style={{ ...tkValue, ...tkTotal }}>
            {((totals?.input ?? 0) + (totals?.output ?? 0)).toLocaleString()}
          </div>
        </div>
      )}
      <div style={byokCaption}>
        Tokens billed directly to your account by your LLM provider. Stelavox does not
        charge for usage on a BYOK plan and does not impose a platform credit cap — your
        provider&apos;s rate limits govern.
      </div>
    </section>
  )
}

function ByokEmptyState() {
  return (
    <div data-testid="cost-meter-empty" style={{ textAlign: 'center', padding: '20px 16px', color: 'var(--color-text-muted)', fontSize: 12, fontStyle: 'italic' }}>
      No LLM activity yet this period.
    </div>
  )
}

// ---------------------------------------------------------------------------
// Styles + helpers
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 8,
  padding: '20px 24px',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}
const titleRow: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  marginBottom: 12,
}
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
}
const subStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
}
const statBigStyle: React.CSSProperties = {
  fontSize: 28,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  lineHeight: 1.1,
  marginTop: 6,
  marginBottom: 4,
}
const usageBar: React.CSSProperties = {
  width: '100%',
  height: 6,
  background: 'var(--color-bg-elevated)',
  borderRadius: 3,
  overflow: 'hidden',
  margin: '6px 0 8px',
}
const usageNumeric: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  fontVariantNumeric: 'tabular-nums',
}
const ctaSoft: React.CSSProperties = {
  background: 'var(--color-bg-elevated)',
  border: '1px dashed var(--color-border-default)',
  borderRadius: 6,
  padding: '12px 14px',
  marginTop: 16,
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  lineHeight: 1.5,
}
const ctaTitle: React.CSSProperties = {
  color: 'var(--color-text-primary)',
  fontWeight: 500,
  marginBottom: 4,
  fontSize: 13,
}
const ctaLink: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
  borderBottom: '1px dotted var(--color-text-muted)',
}
const ctaNote: React.CSSProperties = {
  color: 'var(--color-text-muted)',
  marginLeft: 8,
  fontStyle: 'italic',
}
const tokenTable: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '110px 1fr',
  rowGap: 8,
  columnGap: 12,
  marginTop: 12,
  fontSize: 13,
}
const tkLabel: React.CSSProperties = { color: 'var(--color-text-secondary)' }
const tkValue: React.CSSProperties = {
  color: 'var(--color-text-primary)',
  fontVariantNumeric: 'tabular-nums',
}
const tkTotal: React.CSSProperties = {
  fontWeight: 500,
  paddingTop: 8,
  borderTop: '1px solid var(--color-border-subtle)',
  marginTop: 4,
}
const byokCaption: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-muted)',
  marginTop: 14,
  lineHeight: 1.5,
}

function formatPlanLabel(slug: string): string {
  switch (slug) {
    case 'byok_solo':
      return 'BYOK Solo'
    case 'byok_team':
      return 'BYOK Team'
    case 'trial':
      return 'Trial'
    case 'writer':
      return 'Writer'
    case 'author':
      return 'Author'
    case 'pro':
      return 'Pro'
    default:
      return slug.charAt(0).toUpperCase() + slug.slice(1)
  }
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return new Date(iso).toLocaleString()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}
