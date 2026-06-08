'use client'

/**
 * V1.x-B.1.1 — StatusIndicatorPopover.
 *
 * Opens on AppShellStatusIndicator click. Lists pending Director-attention
 * items grouped by document with deep-link rows.
 *
 * B.1.1 surfaces:
 *   - Active Briefs across the user's documents (deep-link → document)
 *   - Queued Briefs (deep-link → document scheduler)
 *   - Recent failed agent_jobs (deep-link → document)
 *
 * Deferred to V1.x-D:
 *   - Per-document grouping refinement (collapse / expand per document)
 *   - Per-Brief grouping
 *   - Recency sort vs sequence-position sort toggle
 *   - Notification grouping when many events fire close together
 *
 * Inviolable #2: NO verdigris use. Headers / labels in muted Inter;
 * counters in primary; alert-row indicator in attention-amber.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

interface Counts {
  running_jobs: number
  queued_briefs: number
  active_briefs: number
  failed_jobs: number
  alerts: number
}

interface ActiveBriefRow {
  id: string
  document_id: string
  goal_text: string
  status: string
  document_name?: string
  project_id?: string
}

interface QueuedBriefRow extends ActiveBriefRow {
  sequence_position: number
}

interface FailedJobRow {
  id: string
  document_id: string | null
  operation_type: string
  created_at: string
  document_name?: string
  project_id?: string
}

export function StatusIndicatorPopover({ counts, onClose }: { counts: Counts; onClose: () => void }) {
  const [active, setActive] = useState<ActiveBriefRow[]>([])
  const [queued, setQueued] = useState<QueuedBriefRow[]>([])
  const [failed, setFailed] = useState<FailedJobRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    void (async () => {
      const [activeRes, queuedRes, failedRes] = await Promise.all([
        supabase
          .from('briefs')
          .select('id, document_id, goal_text, status, documents(name, project_id)')
          .eq('status', 'active')
          .order('started_at', { ascending: false })
          .limit(20),
        supabase
          .from('briefs')
          .select('id, document_id, goal_text, status, sequence_position, documents(name, project_id)')
          .eq('status', 'queued')
          .order('sequence_position', { ascending: true })
          .limit(20),
        supabase
          .from('agent_jobs')
          .select('id, document_id, operation_type, created_at, documents(name, project_id)')
          .eq('status', 'failed')
          .gte('created_at', dayAgo)
          .order('created_at', { ascending: false })
          .limit(20),
      ])

      type WithDoc<T> = T & { documents?: { name?: string; project_id?: string } | null }
      const flatten = <T,>(rows: WithDoc<T>[] | null) =>
        (rows ?? []).map((r) => ({
          ...r,
          document_name: r.documents?.name,
          project_id: r.documents?.project_id,
        }))

      setActive(flatten<ActiveBriefRow>(activeRes.data as unknown as WithDoc<ActiveBriefRow>[] | null))
      setQueued(flatten<QueuedBriefRow>(queuedRes.data as unknown as WithDoc<QueuedBriefRow>[] | null))
      setFailed(flatten<FailedJobRow>(failedRes.data as unknown as WithDoc<FailedJobRow>[] | null))
      setLoading(false)
    })()
  }, [])

  const empty = !loading && active.length === 0 && queued.length === 0 && failed.length === 0

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          zIndex: 49,
        }}
      />
      <div
        data-testid="status-indicator-popover"
        role="dialog"
        aria-label="Pending Director attention"
        style={{
          // Phase 8 nav refactor (2026-06-08): anchored to top-right
          // beneath the Header (52px tall) where the indicator pill
          // now lives. Replaces the previous bottom-left floating
          // position the chip + popover shared.
          position: 'fixed',
          right: 24,
          top: 60,
          zIndex: 51,
          width: 360,
          maxHeight: '60vh',
          overflowY: 'auto',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 8,
          padding: 12,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          color: 'var(--color-text-primary)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)' }}>Director status</span>
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
            {counts.running_jobs} running · {counts.queued_briefs} queued · {counts.alerts} alerts
          </span>
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 4px' }}>Loading…</div>
        ) : empty ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '12px 4px' }}>No pending items.</div>
        ) : (
          <>
            <Section label="Active Briefs" empty="None" rows={active.length}>
              {active.map((b) => (
                <Link
                  key={b.id}
                  href={`/projects/${b.project_id ?? ''}/documents/${b.document_id}`}
                  onClick={onClose}
                  data-testid="popover-active-brief"
                  style={rowStyle}
                >
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.goal_text}</div>
                    {b.document_name ? <div style={metaStyle}>{b.document_name}</div> : null}
                  </div>
                </Link>
              ))}
            </Section>

            <Section label="Queued Briefs" empty="None" rows={queued.length}>
              {queued.map((b) => (
                <Link
                  key={b.id}
                  href={`/projects/${b.project_id ?? ''}/documents/${b.document_id}/scheduler`}
                  onClick={onClose}
                  data-testid="popover-queued-brief"
                  style={rowStyle}
                >
                  <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.goal_text}</div>
                    {b.document_name ? <div style={metaStyle}>{b.document_name} · pos {b.sequence_position}</div> : null}
                  </div>
                </Link>
              ))}
            </Section>

            {failed.length > 0 ? (
              <Section label="Failed (24h)" empty="None" rows={failed.length}>
                {failed.map((j) => (
                  <Link
                    key={j.id}
                    href={j.document_id && j.project_id ? `/projects/${j.project_id}/documents/${j.document_id}` : '#'}
                    onClick={onClose}
                    data-testid="popover-failed-job"
                    style={{ ...rowStyle, borderLeft: '2px solid rgba(184,48,48,0.5)' }}
                  >
                    <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                      <div>{j.operation_type}</div>
                      {j.document_name ? <div style={metaStyle}>{j.document_name}</div> : null}
                    </div>
                  </Link>
                ))}
              </Section>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

function Section({ label, empty, rows, children }: { label: string; empty: string; rows: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)', padding: '6px 4px 2px' }}>
        {label} {rows > 0 ? `(${rows})` : ''}
      </div>
      {rows === 0 ? <div style={{ ...metaStyle, padding: '4px 8px' }}>{empty}</div> : children}
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 4,
  textDecoration: 'none',
  color: 'var(--color-text-primary)',
}

const metaStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--color-text-muted)',
  marginTop: 2,
}
