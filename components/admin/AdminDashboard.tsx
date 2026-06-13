'use client'

/**
 * AdminDashboard — V1.x-E client component.
 *
 * Source: Component Spec §17.5 · wireframe_admin_dashboard_v1.html.
 *
 * Polls /api/admin/dashboard every 30s and renders all sections.
 * Window selector (1h / 24h / 7d) re-fetches with the chosen param.
 *
 * Inviolables: Inter only (no Lora), no verdigris (admin surfaces are
 * not author-facing affirmative-action triggers; counters use
 * --color-status-review for warn and --color-error for critical).
 *
 * Sections, top-to-bottom:
 *   1. Live counters row (active turns / running / queued / failures-24h)
 *   2. Capacity alerts (when present — promoted to top under counters)
 *   3. Queue depth by class + Anthropic headroom
 *   4. Dispatch rate sparkline + Failures by class
 *   5. Spend leaders (top orgs + by-model)
 *   6. Synthetic probes (status + manual trigger)
 */

import { useCallback, useEffect, useState } from 'react'
import { OperationsSummary } from './OperationsSummary'

type WindowKey = '1h' | '24h' | '7d'

interface CapacityAlert {
  kind: 'anthropic_itpm_high' | 'queue_oldest_stale' | 'failure_rate_high'
  severity: 'warn' | 'critical'
  message: string
  metric: string
  value: number
  threshold: number
  model_id: string | null
  since: string | null
}

interface HeadroomRow {
  model_id: string
  sampled_at: string
  requests_limit: number | null
  requests_remaining: number | null
  input_tokens_limit: number | null
  input_tokens_remaining: number | null
  output_tokens_limit: number | null
  output_tokens_remaining: number | null
}

interface ProbeRow {
  probe_id: string
  triggered_at: string
  completed_at: string | null
  outcome: string | null
  duration_ms: number | null
  failure_class: string | null
}

interface DashboardPayload {
  window: WindowKey
  period_length_days: number
  live_counters: {
    active_turns: number
    running_jobs: number
    queued_jobs: number
    failures_24h: number
    failure_breakdown: Record<string, number>
  }
  queue_depth: Array<{ traffic_class: number; count: number }>
  anthropic_headroom: HeadroomRow[]
  dispatch_rate_series: Array<{ t: string; rate: number }>
  failures_by_class: Array<{ failure_class: string; count: number }>
  auto_recovery_rate: number | null
  spend_leaders: {
    top_orgs: Array<{
      org_id: string
      name: string
      plan: string
      usage_credits: number
      allocation_credits: number | null
    }>
    by_model: Array<{ model_id: string; credits: number }>
  }
  capacity_alerts: CapacityAlert[]
  probes: ProbeRow[]
  audit_log_recent: {
    window_total: number
    rows: AuditLogRow[]
  }
}

// Phase 9.1 / DR-096 — wireframe_admin_audit_log_v1.html.
export interface AuditLogRow {
  id: string
  event_type: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  organisation_id: string | null
  organisation_name: string | null
  user_id: string | null
  document_id: string | null
  conversation_id: string | null
  node_id: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const POLL_MS = 30_000

const cardStyle: React.CSSProperties = {
  background: 'var(--color-bg-surface)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '6px',
  padding: 'var(--space-4)',
}

const counterLabelStyle: React.CSSProperties = {
  fontSize: '9px',
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--color-text-tertiary)',
  marginBottom: 'var(--space-2)',
}

const counterValueStyle: React.CSSProperties = {
  fontSize: '26px',
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
}

function formatPctRemaining(limit: number | null, remaining: number | null): string {
  if (limit == null || remaining == null || limit <= 0) return '—'
  const pct = Math.round((remaining / limit) * 100)
  return `${pct}%`
}

function pctRemaining(limit: number | null, remaining: number | null): number | null {
  if (limit == null || remaining == null || limit <= 0) return null
  return (remaining / limit) * 100
}

function trafficClassLabel(c: number): string {
  if (c === 1) return 'Class 1 — Director'
  if (c === 2) return 'Class 2 — Foreground'
  if (c === 3) return 'Class 3 — Background'
  return 'Class 4 — Scheduled'
}

function probeLabel(id: string): string {
  if (id === 'director_small') return 'Director (small)'
  if (id === 'workflow_expand') return 'Workflow expand'
  if (id === 'refine_accept') return 'Refine + accept'
  return id
}

function relativeAge(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export function AdminDashboard() {
  const [windowKey, setWindowKey] = useState<WindowKey>('1h')
  const [data, setData] = useState<DashboardPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [runningProbes, setRunningProbes] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/dashboard?window=${windowKey}`, {
        cache: 'no-store',
      })
      if (!res.ok) {
        setError(`Dashboard fetch failed: ${res.status}`)
        return
      }
      const json = (await res.json()) as DashboardPayload
      setData(json)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [windowKey])

  useEffect(() => {
    // queueMicrotask defers the initial load past the effect body so
    // setState inside `load` doesn't run synchronously during the effect
    // (satisfies react-hooks/set-state-in-effect for the canonical
    // fetch-on-mount pattern; one-microtask delay is invisible).
    queueMicrotask(() => { void load() })
    const id = window.setInterval(load, POLL_MS)
    return () => window.clearInterval(id)
  }, [load])

  const triggerProbe = useCallback(
    async (probeId: string) => {
      setRunningProbes((s) => new Set(s).add(probeId))
      try {
        await fetch(`/api/admin/probe/${probeId}/run`, { method: 'POST' })
        await load()
      } finally {
        setRunningProbes((s) => {
          const next = new Set(s)
          next.delete(probeId)
          return next
        })
      }
    },
    [load],
  )

  if (error) {
    return (
      <div style={{ ...cardStyle, color: 'var(--color-error)' }}>
        <strong>Admin dashboard error:</strong> {error}
      </div>
    )
  }

  if (!data) {
    return (
      <div style={{ ...cardStyle, color: 'var(--color-text-secondary)' }}>
        Loading admin dashboard…
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      {/* Phase 8 nav: explicit back-affordance. Admin pages otherwise
         strand the user — the only escape was the global Wordmark. */}
      <div style={{ paddingTop: 'var(--space-3)' }}>
        <a
          href="/dashboard"
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          ← Dashboard
        </a>
      </div>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: '4px' }}>
            Platform admin
          </h1>
          <div style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>
            Live operations · refreshes every 30s · window: {data.window}
            <a
              href="/admin/payments"
              style={{
                marginLeft: 14,
                color: 'var(--color-text-secondary)',
                textDecoration: 'none',
                borderBottom: '1px dotted var(--color-text-muted)',
              }}
              data-testid="admin-payments-link"
            >
              → Payments
            </a>
          </div>
        </div>
        <WindowTabs current={windowKey} onChange={setWindowKey} />
      </header>

      {/* DR-121 — Operations Summary (7 bands) leads the dashboard (OA-1). */}
      <OperationsSummary windowKey={windowKey} />

      {/* Capacity alerts — only shown when there are firing alerts. */}
      {data.capacity_alerts.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {data.capacity_alerts.map((a, i) => (
            <AlertBanner key={`${a.kind}-${i}`} alert={a} />
          ))}
        </section>
      )}

      {/* Live counters */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-3)',
        }}
      >
        <Counter label="Active director turns" value={data.live_counters.active_turns} />
        <Counter label="Running jobs" value={data.live_counters.running_jobs} />
        <Counter label="Queued jobs" value={data.live_counters.queued_jobs} />
        <Counter
          label="Failures (24h)"
          value={data.live_counters.failures_24h}
          subline={
            Object.keys(data.live_counters.failure_breakdown).length > 0
              ? Object.entries(data.live_counters.failure_breakdown)
                  .map(([k, v]) => `${k}:${v}`)
                  .join(' · ')
              : undefined
          }
          tone={data.live_counters.failures_24h > 0 ? 'warn' : undefined}
        />
      </section>

      {/* Queue + headroom */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}
      >
        <div style={cardStyle}>
          <CardTitle title="Queue depth by class" subtitle="current snapshot" />
          {data.queue_depth.map((q) => (
            <div
              key={q.traffic_class}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '6px 0',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
              }}
            >
              <span>{trafficClassLabel(q.traffic_class)}</span>
              <span style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {q.count}
              </span>
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <CardTitle
            title="Anthropic headroom"
            subtitle={
              data.anthropic_headroom[0]
                ? `last sampled · ${relativeAge(data.anthropic_headroom[0].sampled_at)}`
                : 'no samples yet'
            }
          />
          {data.anthropic_headroom.length === 0 && (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              No rate-limit samples captured yet — first Anthropic call after deploy populates this.
            </div>
          )}
          {data.anthropic_headroom.map((h) => {
            const pct = pctRemaining(h.input_tokens_limit, h.input_tokens_remaining)
            const tone = pct == null ? null : pct < 25 ? 'bad' : pct < 50 ? 'warn' : null
            return (
              <div
                key={h.model_id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 70px',
                  gap: '10px',
                  padding: '5px 0',
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span>{h.model_id}</span>
                <span
                  style={{
                    color:
                      tone === 'bad'
                        ? 'var(--color-error)'
                        : tone === 'warn'
                          ? 'var(--color-status-review)'
                          : 'var(--color-text-primary)',
                    textAlign: 'right',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatPctRemaining(h.input_tokens_limit, h.input_tokens_remaining)} ITPM
                </span>
              </div>
            )
          })}
        </div>
      </section>

      {/* Dispatch sparkline + failures by class */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}
      >
        <div style={cardStyle}>
          <CardTitle title="Dispatch rate" subtitle="jobs/min · last 60 min" />
          <Sparkline series={data.dispatch_rate_series} />
        </div>

        <div style={cardStyle}>
          <CardTitle
            title="Failures by class"
            subtitle={`window: ${data.window}${
              data.auto_recovery_rate != null
                ? ` · auto-recovery ${Math.round(data.auto_recovery_rate * 100)}%`
                : ''
            }`}
          />
          {data.failures_by_class.map((f) => (
            <FailureRow key={f.failure_class} cls={f.failure_class} count={f.count} />
          ))}
        </div>
      </section>

      {/* Spend leaders */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-3)',
        }}
      >
        <div style={cardStyle}>
          <CardTitle title="Top orgs by usage" subtitle="current period" />
          {data.spend_leaders.top_orgs.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              No orgs with usage in this window.
            </div>
          ) : (
            data.spend_leaders.top_orgs.map((o) => {
              const pct =
                o.allocation_credits && o.allocation_credits > 0
                  ? Math.round((o.usage_credits / o.allocation_credits) * 100)
                  : null
              return (
                <div
                  key={o.org_id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 60px',
                    padding: '5px 0',
                    fontSize: '11px',
                    color: 'var(--color-text-secondary)',
                    gap: '10px',
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {o.name}
                  </span>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>{o.plan}</span>
                  <span
                    style={{
                      textAlign: 'right',
                      color: 'var(--color-text-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {pct != null ? `${pct}%` : '—'}
                  </span>
                </div>
              )
            })
          )}
        </div>

        <div style={cardStyle}>
          <CardTitle title="Spend by model" subtitle={`window: ${data.window}`} />
          {data.spend_leaders.by_model.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
              No completed jobs in this window.
            </div>
          ) : (
            data.spend_leaders.by_model.slice(0, 6).map((m) => (
              <div
                key={m.model_id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '5px 0',
                  fontSize: '11px',
                  color: 'var(--color-text-secondary)',
                }}
              >
                <span>{m.model_id}</span>
                <span style={{ color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(m.credits).toLocaleString()} cr
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* Synthetic probes */}
      <section style={cardStyle}>
        <CardTitle title="Synthetic probes" subtitle="manual trigger" />
        {(['director_small', 'workflow_expand', 'refine_accept'] as const).map((id) => {
          const last = data.probes.find((p) => p.probe_id === id)
          const isRunning = runningProbes.has(id)
          const outcomeColor =
            last?.outcome === 'pass'
              ? 'var(--color-text-secondary)'
              : last?.outcome === 'fail'
                ? 'var(--color-error)'
                : 'var(--color-text-tertiary)'
          return (
            <div
              key={id}
              style={{
                display: 'grid',
                gridTemplateColumns: '180px 1fr 80px 90px',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 0',
                fontSize: '11px',
                color: 'var(--color-text-secondary)',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span style={{ color: 'var(--color-text-primary)' }}>{probeLabel(id)}</span>
              <span style={{ color: outcomeColor }}>
                {last
                  ? `${last.outcome ?? 'pending'} · ${last.duration_ms ?? '—'}ms · ${relativeAge(
                      last.completed_at ?? last.triggered_at,
                    )}`
                  : 'never run'}
              </span>
              <span style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                {last?.failure_class ? `class ${last.failure_class}` : ''}
              </span>
              <button
                type="button"
                onClick={() => void triggerProbe(id)}
                disabled={isRunning}
                style={{
                  fontSize: '11px',
                  padding: '4px 10px',
                  background: 'transparent',
                  color: isRunning ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  border: '1px solid var(--color-border-strong)',
                  borderRadius: '3px',
                  cursor: isRunning ? 'wait' : 'pointer',
                }}
              >
                {isRunning ? 'Running…' : 'Run now'}
              </button>
            </div>
          )
        })}
      </section>

      {/* Audit log — Phase 9.1 / DR-096; wireframe_admin_audit_log_v1.html */}
      <AuditLogSection
        windowKey={windowKey}
        windowTotal={data.audit_log_recent.window_total}
        firstPage={data.audit_log_recent.rows}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Audit log section (DR-096 — wireframe D1-D6 locked 2026-06-10)
// ---------------------------------------------------------------------------

const SEVERITY_META: Record<
  string,
  { label: string; dot: string; text: string }
> = {
  critical: { label: 'Critical', dot: 'var(--color-error)', text: 'var(--color-error)' },
  high: { label: 'High', dot: 'var(--color-status-review)', text: 'var(--color-status-review)' },
  medium: { label: 'Medium', dot: 'var(--color-warning, #a8821a)', text: 'var(--color-text-secondary)' },
  low: { label: 'Low', dot: 'var(--color-text-tertiary)', text: 'var(--color-text-tertiary)' },
  info: { label: 'Info', dot: 'var(--color-info)', text: 'var(--color-text-secondary)' },
}

function AuditLogSection({
  windowKey,
  windowTotal,
  firstPage,
}: {
  windowKey: WindowKey
  windowTotal: number
  firstPage: AuditLogRow[]
}) {
  // Severity chip filter (D3 — client-side; counts stay honest).
  const [severityFilter, setSeverityFilter] = useState<string | null>(null)
  // Expanded row id (D4 — inline expansion, no modal).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // "Load more" pages append below the polled first page (annotation 5:
  // the 30s poll refreshes only the newest rows; loaded history stays
  // stable so reading isn't disrupted). Reset on window change.
  const [olderRows, setOlderRows] = useState<AuditLogRow[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window change invalidates the pagination cursor; clearing is the correct reset
    setOlderRows([])
  }, [windowKey])

  // Merge + dedupe (a poll refresh may overlap the first loaded page).
  const seen = new Set<string>()
  const allRows: AuditLogRow[] = []
  for (const r of [...firstPage, ...olderRows]) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    allRows.push(r)
  }

  const counts = new Map<string, number>()
  for (const r of allRows) counts.set(r.severity, (counts.get(r.severity) ?? 0) + 1)

  const visible = severityFilter ? allRows.filter((r) => r.severity === severityFilter) : allRows

  async function loadMore() {
    if (allRows.length === 0) return
    setLoadingMore(true)
    try {
      const cursor = allRows[allRows.length - 1].created_at
      const res = await fetch(
        `/api/admin/dashboard?window=${windowKey}&audit_before=${encodeURIComponent(cursor)}`,
        { cache: 'no-store' },
      )
      if (res.ok) {
        const body = (await res.json()) as DashboardPayload
        setOlderRows((prev) => [...prev, ...body.audit_log_recent.rows])
      }
    } catch {
      // transient fetch failure — the button stays available for retry
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <section style={cardStyle} data-testid="admin-audit-log">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <CardTitle title="Audit log" subtitle={`${windowKey} · ${windowTotal} events`} />
        <div style={{ display: 'flex', gap: '4px' }}>
          {[null, 'critical', 'high', 'medium', 'info'].map((sev) => {
            const active = severityFilter === sev
            const meta = sev ? SEVERITY_META[sev] : null
            const count = sev ? (counts.get(sev) ?? 0) : allRows.length
            return (
              <button
                key={sev ?? 'all'}
                type="button"
                onClick={() => setSeverityFilter(sev)}
                style={{
                  fontSize: '10px',
                  padding: '2px 9px',
                  borderRadius: '999px',
                  background: active ? 'var(--color-bg-elevated)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  border: `1px solid ${active ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                {meta ? (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: meta.dot,
                      display: 'inline-block',
                    }}
                  />
                ) : null}
                {meta ? `${meta.label} (${count})` : `All (${count})`}
              </button>
            )
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          style={{
            padding: '18px',
            textAlign: 'center',
            fontSize: '11px',
            color: 'var(--color-text-tertiary)',
          }}
        >
          No audit events in this window. Quiet is good.
        </div>
      ) : (
        <div>
          {visible.map((r) => {
            const meta = SEVERITY_META[r.severity] ?? SEVERITY_META.info
            const expanded = expandedId === r.id
            const refs = [
              r.document_id ? 'doc' : null,
              r.conversation_id ? 'conversation' : null,
              r.node_id ? 'node' : null,
            ].filter(Boolean)
            const preview = r.metadata
              ? Object.entries(r.metadata)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')
              : ''
            return (
              <div key={r.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') setExpandedId(expanded ? null : r.id)
                  }}
                  data-testid="audit-log-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '86px 70px 1fr 160px 90px',
                    gap: '10px',
                    alignItems: 'center',
                    padding: '8px 4px',
                    fontSize: '11px',
                    borderBottom: '1px solid var(--color-border-subtle)',
                    cursor: 'pointer',
                    background: expanded ? 'var(--color-bg-elevated)' : 'transparent',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '9.5px',
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      color: meta.text,
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        background: meta.dot,
                        flexShrink: 0,
                      }}
                    />
                    {meta.label}
                  </span>
                  <span style={{ color: 'var(--color-text-tertiary)', fontSize: '10px' }}>
                    {relativeAge(r.created_at)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontFamily: 'ui-monospace, monospace',
                        fontSize: '10.5px',
                        color: 'var(--color-text-primary)',
                      }}
                    >
                      {r.event_type}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--color-text-tertiary)',
                        fontSize: '10px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {preview}
                    </span>
                  </span>
                  <span
                    style={{
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '9.5px',
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {r.organisation_id
                      ? `${r.organisation_id.slice(0, 8)}${r.organisation_name ? ` · ${r.organisation_name}` : ''}`
                      : '—'}
                  </span>
                  <span
                    style={{
                      color: 'var(--color-text-tertiary)',
                      fontSize: '10px',
                      textAlign: 'right',
                    }}
                  >
                    {refs.length > 0 ? refs.join(' · ') : '—'}
                  </span>
                </div>
                {expanded ? (
                  <pre
                    data-testid="audit-log-expand"
                    style={{
                      margin: '2px 0 6px',
                      padding: '10px 14px',
                      background: 'var(--color-bg-base)',
                      borderRadius: '4px',
                      fontFamily: 'ui-monospace, monospace',
                      fontSize: '10.5px',
                      color: 'var(--color-text-secondary)',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.6,
                      overflow: 'auto',
                    }}
                  >
                    {[
                      `event_type:  ${r.event_type}`,
                      `severity:    ${r.severity}`,
                      `created_at:  ${r.created_at}`,
                      r.organisation_id ? `org:         ${r.organisation_id}${r.organisation_name ? ` (${r.organisation_name})` : ''}` : null,
                      r.user_id ? `user:        ${r.user_id}` : null,
                      r.document_id ? `document:    ${r.document_id}` : null,
                      r.conversation_id ? `conversation: ${r.conversation_id}` : null,
                      r.node_id ? `node:        ${r.node_id}` : null,
                      'metadata:',
                      JSON.stringify(r.metadata ?? {}, null, 2),
                    ]
                      .filter((l) => l !== null)
                      .join('\n')}
                  </pre>
                ) : null}
              </div>
            )
          })}
          {allRows.length >= 50 && allRows.length < windowTotal ? (
            <div style={{ textAlign: 'center', padding: '10px 0 2px' }}>
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                style={{
                  fontSize: '11px',
                  padding: '5px 16px',
                  background: 'transparent',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: '4px',
                  cursor: loadingMore ? 'wait' : 'pointer',
                }}
              >
                {loadingMore ? 'Loading…' : 'Load 50 more'}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function WindowTabs({ current, onChange }: { current: WindowKey; onChange: (w: WindowKey) => void }) {
  const opts: WindowKey[] = ['1h', '24h', '7d']
  return (
    <div style={{ display: 'flex', gap: '4px' }}>
      {opts.map((o) => {
        const active = o === current
        return (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            style={{
              fontSize: '11px',
              padding: '5px 12px',
              background: active ? 'var(--color-bg-elevated)' : 'transparent',
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              border: `1px solid ${active ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            {o}
          </button>
        )
      })}
    </div>
  )
}

function Counter({
  label,
  value,
  subline,
  tone,
}: {
  label: string
  value: number
  subline?: string
  tone?: 'warn' | 'bad'
}) {
  const colour =
    tone === 'bad'
      ? 'var(--color-error)'
      : tone === 'warn'
        ? 'var(--color-status-review)'
        : 'var(--color-text-primary)'
  return (
    <div style={cardStyle}>
      <div style={counterLabelStyle}>{label}</div>
      <div style={{ ...counterValueStyle, color: colour }}>{value}</div>
      {subline && (
        <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>{subline}</div>
      )}
    </div>
  )
}

function CardTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-3)',
      }}
    >
      <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--color-text-primary)' }}>{title}</span>
      {subtitle && (
        <span style={{ fontSize: '10px', fontWeight: 300, color: 'var(--color-text-tertiary)' }}>{subtitle}</span>
      )}
    </div>
  )
}

function AlertBanner({ alert }: { alert: CapacityAlert }) {
  const tone = alert.severity === 'critical' ? 'var(--color-error)' : 'var(--color-status-review)'
  return (
    <div
      role="status"
      style={{
        background: 'var(--color-bg-surface)',
        border: `1px solid ${tone}`,
        borderLeft: `3px solid ${tone}`,
        borderRadius: '4px',
        padding: 'var(--space-3) var(--space-4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
      }}
    >
      <div>
        <div style={{ fontSize: '12px', fontWeight: 500, color: tone }}>
          {alert.kind.replace(/_/g, ' ')}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
          {alert.message}
        </div>
      </div>
      <div
        style={{
          fontSize: '11px',
          color: 'var(--color-text-tertiary)',
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'right',
        }}
      >
        {alert.metric}: {alert.value} (≥ {alert.threshold})
      </div>
    </div>
  )
}

function FailureRow({ cls, count }: { cls: string; count: number }) {
  const tone =
    cls === 'D' || cls === 'E'
      ? 'var(--color-error)'
      : cls === 'B' || cls === 'C'
        ? 'var(--color-status-review)'
        : 'var(--color-info)'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '24px 1fr 60px',
        gap: '8px',
        alignItems: 'center',
        padding: '5px 0',
        fontSize: '11px',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '22px',
          height: '18px',
          fontSize: '10px',
          fontWeight: 600,
          borderRadius: '3px',
          background: 'transparent',
          color: tone,
          border: `1px solid ${tone}`,
        }}
      >
        {cls}
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>{failureClassLabel(cls)}</span>
      <span
        style={{
          color: 'var(--color-text-primary)',
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {count}
      </span>
    </div>
  )
}

function failureClassLabel(c: string): string {
  switch (c) {
    case 'A':
      return 'Transient (auto-retried)'
    case 'B':
      return 'Interrupted (resume)'
    case 'C':
      return 'Capacity (queue back-off)'
    case 'D':
      return 'Validation (model error)'
    case 'E':
      return 'Hard system'
    default:
      return c
  }
}

function Sparkline({ series }: { series: Array<{ t: string; rate: number }> }) {
  if (series.length === 0) {
    return (
      <div style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
        No dispatch data in window.
      </div>
    )
  }
  const max = Math.max(1, ...series.map((p) => p.rate))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '40px' }}>
      {series.map((p, i) => {
        const h = Math.max(2, Math.round((p.rate / max) * 40))
        return (
          <div
            key={`${p.t}-${i}`}
            title={`${p.t}: ${p.rate.toFixed(2)} jobs/min`}
            style={{
              flex: 1,
              height: `${h}px`,
              background: 'var(--color-text-tertiary)',
              opacity: 0.6,
              borderRadius: '1px',
              minHeight: '2px',
            }}
          />
        )
      })}
    </div>
  )
}
