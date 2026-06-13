'use client'

/**
 * DR-121 — Operations Summary. Seven bands atop /admin answering
 * "is the whole system healthy + what does it cost". Inter only; no
 * verdigris (status-green is --color-success, distinct from brand accent).
 *
 * Source: wireframe_admin_ops_summary_v1.html + design note v1.2.
 * Feed: GET /api/admin/ops (almost entirely derived).
 */

import { useCallback, useEffect, useState } from 'react'

interface OpsData {
  health: { status: 'healthy' | 'degraded' | 'critical'; issues: Array<{ severity: string; text: string; link: string }> }
  liveness: {
    dispatcher_last_tick_age_sec: number | null
    cloud_transport_last_ok_age_sec: number | null
    cron_jobs: Array<{ jobname: string; last_run: string | null; status: string | null }>
    realtime_publication_count: number
  }
  dependencies: {
    anthropic: { probe_outcome: string | null; probe_age_sec: number | null; job_error_rate: number }
    database: { reachable: boolean; latency_ms: number }
    stripe: { last_webhook_age_sec: number | null }
  }
  volume: { total_orgs: number; by_plan: Record<string, number>; by_status: Record<string, number>; new_orgs: number; active_orgs: number; tokens_in_window: number }
  storage: { exports_in_window: number; by_format: Record<string, number>; failed: number; failed_rate: number; storage_bytes: number; largest_bytes: number; per_file_limit_mb: number }
  economics: {
    cohorts: Array<{ plan: string; users: number; tokens: number; cost_usd: number; avg_utilisation: number; revenue_usd: number; net_usd: number }>
    trial_liability: { cost_usd: number; projected_month_end_usd: number; users: number }
  }
  reconciliation: {
    platform_tokens: number; platform_cost_usd: number
    by_model: Array<{ model_id: string; input: number; output: number; cost_usd: number }>
    mom_platform_usd: Array<{ month: string; usd: number }>
    byok: { users: number; tokens: number; avg_tokens_per_user: number; platform_avg_tokens_per_user: number }
  }
}

const OK = 'var(--color-success, #3a8a5a)'
const AMBER = 'var(--color-status-review)'
const RED = 'var(--color-error)'

function fmtAge(s: number | null): string {
  if (s === null) return '—'
  if (s < 90) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  return `${Math.round(s / 3600)}h ago`
}
function fmtTok(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}
function fmtMB(bytes: number): string { return `${(bytes / 1048576).toFixed(0)} MB` }

export function OperationsSummary({ windowKey }: { windowKey: string }) {
  const [data, setData] = useState<OpsData | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/ops?window=${windowKey}`, { cache: 'no-store' })
      if (!res.ok) { setError(`ops feed ${res.status}`); return }
      setError(null)
      setData(await res.json() as OpsData)
    } catch (e) { setError(e instanceof Error ? e.message : 'load failed') }
  }, [windowKey])

  useEffect(() => {
    void load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  if (error) return <div style={{ ...card, color: RED }} data-testid="ops-error">Operations feed: {error}</div>
  if (!data) return <div style={{ ...card, color: 'var(--color-text-secondary)' }}>Loading operations summary…</div>

  const healthColor = data.health.status === 'critical' ? RED : data.health.status === 'degraded' ? AMBER : OK
  const cronHealthy = data.liveness.cron_jobs.filter(c => c.status === 'succeeded' || c.status === 'running' || c.status === null).length
  const dispDot = data.liveness.dispatcher_last_tick_age_sec === null || data.liveness.dispatcher_last_tick_age_sec < 90 ? OK : data.liveness.dispatcher_last_tick_age_sec < 300 ? AMBER : RED
  const cloudDot = data.liveness.cloud_transport_last_ok_age_sec === null ? AMBER : data.liveness.cloud_transport_last_ok_age_sec < 120 ? OK : data.liveness.cloud_transport_last_ok_age_sec < 600 ? AMBER : RED

  return (
    <div data-testid="operations-summary" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Band 1 — health */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span data-testid="ops-health-status" style={{
            fontSize: 13, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase',
            padding: '6px 14px', borderRadius: 5, color: healthColor, border: `1px solid ${healthColor}`,
          }}>{data.health.status}</span>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {data.health.issues.length === 0 ? 'All systems nominal — writing unaffected' : `${data.health.issues.length} active issue${data.health.issues.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {data.health.issues.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.health.issues.map((iss, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, fontSize: 12, padding: '7px 10px', background: 'var(--color-bg-base)', borderRadius: 4, borderLeft: `2px solid ${iss.severity === 'critical' ? RED : AMBER}` }}>
                <span style={{ fontSize: 9, fontWeight: 600, textTransform: 'uppercase', color: iss.severity === 'critical' ? RED : AMBER, width: 54 }}>{iss.severity}</span>
                <span style={{ color: 'var(--color-text-secondary)' }}>{iss.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Band 2 — liveness */}
      <div style={card}>
        <Label>Liveness &amp; heartbeats</Label>
        <div style={grid4}>
          <Tile dot={dispDot} label="Dispatcher" value={fmtAge(data.liveness.dispatcher_last_tick_age_sec)} sub="last tick" />
          <Tile dot={cloudDot} label="Cloud transport" value={data.liveness.cloud_transport_last_ok_age_sec === null ? 'no data' : fmtAge(data.liveness.cloud_transport_last_ok_age_sec)} sub="pg_net last 200" />
          <Tile dot={data.liveness.realtime_publication_count >= 10 ? OK : AMBER} label="Realtime" value={`${data.liveness.realtime_publication_count} tables`} sub="publication" />
          <Tile dot={cronHealthy === data.liveness.cron_jobs.length ? OK : RED} label="pg_cron" value={`${cronHealthy} / ${data.liveness.cron_jobs.length} ok`} sub="scheduled jobs" />
        </div>
      </div>

      {/* Band 3 — dependencies */}
      <div style={card}>
        <Label>External dependencies</Label>
        <div style={grid3}>
          <Tile dot={data.dependencies.anthropic.probe_outcome === 'fail' ? RED : OK} label="Anthropic" value={data.dependencies.anthropic.probe_outcome === 'fail' ? 'Probe failing' : 'Reachable'} sub={`probe ${fmtAge(data.dependencies.anthropic.probe_age_sec)}`} />
          <Tile dot={OK} label="Database" value={`${data.dependencies.database.latency_ms} ms`} sub="SELECT latency" />
          <Tile dot={data.dependencies.stripe.last_webhook_age_sec === null ? AMBER : OK} label="Stripe" value={data.dependencies.stripe.last_webhook_age_sec === null ? 'no webhooks' : `webhook ${fmtAge(data.dependencies.stripe.last_webhook_age_sec)}`} sub="last event" />
        </div>
      </div>

      {/* Band 4 — volume & growth */}
      <div style={card}>
        <Label>Volume &amp; growth · {windowKey}</Label>
        <div style={grid4}>
          <Tile label="Total orgs" value={String(data.volume.total_orgs)} sub={Object.entries(data.volume.by_plan).map(([p, n]) => `${n} ${p}`).join(' · ')} />
          <Tile label="New" value={String(data.volume.new_orgs)} sub="in window" />
          <Tile label="Active orgs" value={String(data.volume.active_orgs)} sub="≥1 job" />
          <Tile label="Tokens" value={fmtTok(data.volume.tokens_in_window)} sub="in window" />
        </div>
      </div>

      {/* Band 5 — export & storage */}
      <div style={card}>
        <Label>Export &amp; storage · {windowKey}</Label>
        <div style={grid4}>
          <Tile label="Exports" value={String(data.storage.exports_in_window)} sub={Object.entries(data.storage.by_format).map(([f, n]) => `${n} ${f}`).join(' · ') || '—'} />
          <Tile dot={data.storage.failed_rate > 0.1 ? AMBER : OK} label="Failed rate" value={`${(data.storage.failed_rate * 100).toFixed(1)}%`} sub={`${data.storage.failed} failed`} />
          <Tile label="Storage used" value={fmtMB(data.storage.storage_bytes)} sub="non-expired" />
          <Tile label="Largest file" value={fmtMB(data.storage.largest_bytes)} sub={`vs ${data.storage.per_file_limit_mb} MB limit`} />
        </div>
      </div>

      {/* Band 6 — plan economics */}
      <div style={card}>
        <Label>Plan &amp; subscriber economics · platform route</Label>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="ops-economics-table">
          <thead><tr style={{ color: 'var(--color-text-muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em' }}>
            <th style={th}>Cohort</th><th style={thR}>Users</th><th style={thR}>Tokens</th><th style={thR}>Cost $</th><th style={thR}>Util</th><th style={thR}>Revenue</th><th style={thR}>Net</th>
          </tr></thead>
          <tbody>
            {data.economics.cohorts.map(c => {
              const isTrial = c.plan === 'trial'
              return (
                <tr key={c.plan} style={isTrial ? { background: 'rgba(184,56,56,.06)' } : { borderTop: '1px solid var(--color-border-subtle)' }}>
                  <td style={td}>
                    <span style={{ color: 'var(--color-text-primary)', textTransform: 'capitalize' }}>{c.plan}</span>
                    {isTrial && <span style={{ color: RED, fontSize: 9, marginLeft: 6, letterSpacing: '.1em' }}>LIABILITY</span>}
                  </td>
                  <td style={tdR}>{c.users}</td>
                  <td style={tdR}>{fmtTok(c.tokens)}</td>
                  <td style={{ ...tdR, color: 'var(--color-text-primary)' }}>${c.cost_usd.toFixed(2)}</td>
                  <td style={tdR}>{(c.avg_utilisation * 100).toFixed(0)}%</td>
                  <td style={tdR}>{isTrial ? '$0' : `$${c.revenue_usd.toFixed(0)}`}</td>
                  <td style={{ ...tdR, color: c.net_usd < 0 ? RED : OK, fontWeight: 500 }}>{c.net_usd < 0 ? '−' : '+'}${Math.abs(c.net_usd).toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div style={{ marginTop: 12, padding: '10px 12px', border: `1px solid ${RED}33`, borderRadius: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: RED, marginBottom: 6 }}>Trial liability — pure cost, no revenue</div>
          <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <span>This period: <strong style={{ color: RED }}>${data.economics.trial_liability.cost_usd.toFixed(2)}</strong></span>
            <span>Projected month-end: <strong style={{ color: RED }}>${data.economics.trial_liability.projected_month_end_usd.toFixed(2)}</strong></span>
            <span>{data.economics.trial_liability.users} trials</span>
          </div>
        </div>
      </div>

      {/* Band 7 — provider reconciliation */}
      <div style={card}>
        <Label>LLM provider reconciliation · platform route = the Anthropic invoice</Label>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="ops-reconciliation-table">
          <thead><tr style={{ color: 'var(--color-text-muted)', fontSize: 9, textTransform: 'uppercase', letterSpacing: '.08em' }}>
            <th style={th}>Model</th><th style={thR}>Input</th><th style={thR}>Output</th><th style={thR}>Actual $</th>
          </tr></thead>
          <tbody>
            {data.reconciliation.by_model.map(m => (
              <tr key={m.model_id} style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
                <td style={{ ...td, color: 'var(--color-text-primary)' }}>{m.model_id}</td>
                <td style={tdR}>{fmtTok(m.input)}</td><td style={tdR}>{fmtTok(m.output)}</td>
                <td style={{ ...tdR, color: 'var(--color-text-primary)' }}>${m.cost_usd.toFixed(2)}</td>
              </tr>
            ))}
            {data.reconciliation.by_model.length === 0 && <tr><td style={td} colSpan={4}>No platform usage in window.</td></tr>}
          </tbody>
          <tfoot><tr style={{ borderTop: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)', fontWeight: 500 }}>
            <td style={td}>Total platform</td><td style={tdR}>{fmtTok(data.reconciliation.platform_tokens)}</td><td style={tdR}></td><td style={tdR}>${data.reconciliation.platform_cost_usd.toFixed(2)}</td>
          </tr></tfoot>
        </table>
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-muted)' }} data-testid="ops-byok-compare">
          BYOK (informational, $0 to platform): {data.reconciliation.byok.users} users · avg {fmtTok(data.reconciliation.byok.avg_tokens_per_user)} tok/user
          {data.reconciliation.byok.platform_avg_tokens_per_user > 0 && data.reconciliation.byok.avg_tokens_per_user > 0 &&
            ` (${(data.reconciliation.byok.avg_tokens_per_user / data.reconciliation.byok.platform_avg_tokens_per_user).toFixed(1)}× platform)`}
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 12 }}>{children}</div>
}
function Tile({ dot, label, value, sub }: { dot?: string; label: string; value: string; sub?: string }) {
  return (
    <div style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border-subtle)', borderRadius: 5, padding: '11px 12px' }}>
      <div style={{ fontSize: 9.5, fontWeight: 500, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--color-text-muted)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
        {dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: dot, flexShrink: 0 }} />}{label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--color-text-primary)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--color-text-muted)', marginTop: 3 }}>{sub}</div>}
    </div>
  )
}

const card: React.CSSProperties = { background: 'var(--color-bg-surface)', border: '1px solid var(--color-border-subtle)', borderRadius: 8, padding: '16px 18px', fontFamily: 'var(--font-inter), Inter, sans-serif' }
const grid4: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }
const grid3: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--color-border-subtle)' }
const thR: React.CSSProperties = { ...th, textAlign: 'right' }
const td: React.CSSProperties = { padding: '8px', color: 'var(--color-text-secondary)' }
const tdR: React.CSSProperties = { ...td, textAlign: 'right' }
