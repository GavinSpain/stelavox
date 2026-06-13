'use client'

/**
 * OrchestrationAudit — Apollo state-machine observability UI.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §13.2.
 *
 * Renders:
 *   * Green/red banner: is the system in a known consistent state?
 *   * Per-invariant violation counts.
 *   * Table of individual violations with entity_id / details.
 *   * "Run reconcile" button (POSTs the on-demand sweep).
 *   * "Force-reset document" entry (admin types document UUID).
 *
 * Inter typography only (admin surface, not author-facing). No verdigris.
 */

import { useCallback, useEffect, useState } from 'react'

interface AuditResponse {
  clean: boolean
  total_violations: number
  by_invariant: Record<string, number>
  by_entity: Record<string, number>
  violations: Array<{
    invariant_id: string
    entity_table: string
    entity_id: string
    violation: string
    details: unknown
  }>
  audited_at: string
}

interface ReconcileResponse {
  ok: boolean
  result: {
    reconciled_at: string
    heartbeat_stale_swept: number
    stuck_claims_swept: number
    workflows_propagated: number
    briefs_propagated: number
    stages_reverted: number
    audit_violations_logged: number
  }
}

export function OrchestrationAudit() {
  const [audit, setAudit] = useState<AuditResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [resetDocId, setResetDocId] = useState('')
  const [resetResult, setResetResult] = useState<string | null>(null)
  const [reconcileResult, setReconcileResult] = useState<ReconcileResponse['result'] | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/orchestration/audit', { cache: 'no-store' })
      const body = (await res.json()) as AuditResponse
      setAudit(body)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Mount-time fetch — refresh() synchronously sets the loading flag
    // before its first await. That's a legitimate fetch-on-mount, not a
    // cascading-render hazard (same convention as useDirectorConversation).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    // Poll every 30s — matches the reconcile sweep cadence.
    const interval = setInterval(refresh, 30_000)
    return () => clearInterval(interval)
  }, [refresh])

  const handleReconcile = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/orchestration/reconcile', { method: 'POST' })
      const body = (await res.json()) as ReconcileResponse
      setReconcileResult(body.result)
      await refresh()
    } finally {
      setLoading(false)
    }
  }, [refresh])

  const handleForceReset = useCallback(async () => {
    if (!resetDocId.trim()) return
    const confirmed = confirm(`Force-reset document ${resetDocId}? This cancels every active brief + in-flight orchestration entity. Cannot be undone.`)
    if (!confirmed) return
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orchestration/force-reset/${resetDocId.trim()}`, { method: 'POST' })
      const body = await res.json()
      setResetResult(JSON.stringify(body, null, 2))
      await refresh()
    } finally {
      setLoading(false)
    }
  }, [resetDocId, refresh])

  return (
    <div style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', fontFamily: 'var(--font-inter)' }}>
      {/* Phase 8 nav: explicit back-affordance to the admin landing. */}
      <div style={{ marginBottom: 16 }}>
        <a
          href="/admin"
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
          }}
        >
          ← Admin
        </a>
      </div>
      <h1 style={{ fontSize: 24, fontWeight: 600, marginBottom: 8 }}>Orchestration audit</h1>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24, fontSize: 14 }}>
        Apollo-grade state-machine integrity check. Empty → system is in a known consistent state.
        See <code>docs/stelavox_brief_orchestration_v1_0.md §13</code>.
      </p>

      {/* Status banner */}
      {audit && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 6,
            background: audit.clean ? 'rgba(56, 142, 60, 0.12)' : 'rgba(184, 112, 48, 0.16)',
            border: `1px solid ${audit.clean ? 'var(--color-success, #4caf50)' : 'var(--color-status-review)'}`,
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          {audit.clean
            ? `✓ System is in a known consistent state (audited ${new Date(audit.audited_at).toLocaleTimeString()}).`
            : `⚠ ${audit.total_violations} drift violations detected.`}
        </div>
      )}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          style={buttonStyle}
        >
          {loading ? 'Loading…' : 'Refresh audit'}
        </button>
        <button
          type="button"
          onClick={handleReconcile}
          disabled={loading}
          style={buttonStyle}
        >
          Run reconcile sweep
        </button>
      </div>

      {/* Reconcile result */}
      {reconcileResult && (
        <details style={{ marginBottom: 24, padding: 12, background: 'var(--color-bg-elevated)', borderRadius: 6, fontSize: 13 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 500 }}>
            Last reconcile: {new Date(reconcileResult.reconciled_at).toLocaleTimeString()}
          </summary>
          <pre style={{ margin: '8px 0 0 0', fontSize: 12 }}>
            {`Heartbeat stale swept: ${reconcileResult.heartbeat_stale_swept}
Stuck claims swept:    ${reconcileResult.stuck_claims_swept}
Workflows propagated:  ${reconcileResult.workflows_propagated}
Briefs propagated:     ${reconcileResult.briefs_propagated}
Stages reverted:       ${reconcileResult.stages_reverted}
Audit logged:          ${reconcileResult.audit_violations_logged}`}
          </pre>
        </details>
      )}

      {/* Per-invariant counts */}
      {audit && !audit.clean && (
        <section style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>By invariant</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {Object.entries(audit.by_invariant).map(([id, count]) => (
              <div key={id} style={{ padding: '6px 10px', background: 'var(--color-bg-elevated)', borderRadius: 4, fontSize: 13 }}>
                <strong>{id}</strong>: {count}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Violations table */}
      {audit && audit.violations.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Violations</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border-default)' }}>
                <th style={cellHeader}>Invariant</th>
                <th style={cellHeader}>Entity</th>
                <th style={cellHeader}>ID</th>
                <th style={cellHeader}>Violation</th>
              </tr>
            </thead>
            <tbody>
              {audit.violations.map((v, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td style={cell}>{v.invariant_id}</td>
                  <td style={cell}>{v.entity_table}</td>
                  <td style={{ ...cell, fontFamily: 'monospace', fontSize: 11 }}>{v.entity_id}</td>
                  <td style={cell}>{v.violation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Force-reset */}
      <section style={{ marginTop: 32, padding: 16, border: '1px solid var(--color-border-default)', borderRadius: 6 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Apollo reset button</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginBottom: 12 }}>
          Force-cancels every in-flight orchestration entity for a document. Use when a stuck state can&apos;t be cleared via the normal Cancel path.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Document UUID"
            value={resetDocId}
            onChange={(e) => setResetDocId(e.target.value)}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: '1px solid var(--color-border-default)',
              borderRadius: 4,
              background: 'var(--color-bg-base)',
              color: 'var(--color-text-primary)',
              fontFamily: 'monospace',
              fontSize: 13,
            }}
          />
          <button
            type="button"
            onClick={handleForceReset}
            disabled={loading || !resetDocId.trim()}
            style={{ ...buttonStyle, background: 'var(--color-error)', color: 'var(--color-bg-base)' }}
          >
            Force-reset
          </button>
        </div>
        {resetResult && (
          <pre style={{ marginTop: 12, padding: 12, background: 'var(--color-bg-elevated)', borderRadius: 4, fontSize: 12, overflow: 'auto' }}>
            {resetResult}
          </pre>
        )}
      </section>
    </div>
  )
}

const buttonStyle: React.CSSProperties = {
  padding: '8px 14px',
  background: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-default)',
  borderRadius: 4,
  color: 'var(--color-text-primary)',
  fontSize: 14,
  cursor: 'pointer',
}

const cellHeader: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 500,
  color: 'var(--color-text-secondary)',
}

const cell: React.CSSProperties = {
  padding: '8px 12px',
  verticalAlign: 'top',
}
