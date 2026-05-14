'use client'

/**
 * V1.x-B.1.1 — SchedulerPanel routable view.
 *
 * CS v2.10 §17.4 — Brief → Stage → Workflow → Step hierarchy with
 * level-appropriate actions. B.1.1 ships:
 *   - read-only queue display (active Brief + queued Briefs + recent
 *     agent_jobs)
 *   - Cancel on jobs (best-effort) and Briefs (cascade)
 *   - Reschedule (scheduled_at inline edit) on pending/running jobs
 *   - Execution intent toggle (immediate / scheduled / parked) — silent
 *     edit per design record §12
 *   - Reorder queued Briefs via drag-affordance-free up/down buttons
 *     (drag-and-drop polish in V1.x-D)
 *
 * Stop, batched_24h toggle, top-up CTA, AI-changed flag, full Resume
 * UX all defer to later phases.
 *
 * Inviolable discipline: Inter typography only; no verdigris use
 * (Cancel + reorder are neutral primary; cascade-confirm modal handles
 * affirmative-action gate via destructive-action token, not verdigris #7).
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { BriefQueueState } from '@/lib/brief/types'

interface SchedulerPanelProps {
  projectId: string
  documentId: string
  documentName: string
}

interface AgentJobRow {
  id: string
  operation_type: string
  status: string
  traffic_class: number
  execution_intent: 'immediate' | 'parked' | 'scheduled' | 'batched_24h'
  scheduled_at: string | null
  cause: string | null
  route: 'platform' | 'byok'
  created_at: string
  completed_at: string | null
}

interface QueuePayload {
  brief: BriefQueueState
  jobs: AgentJobRow[]
}

const JOB_STATUS_COLOUR: Record<string, string> = {
  pending: 'var(--color-text-secondary)',
  running: 'var(--color-agent-running, var(--color-text-primary))',
  completed: 'var(--color-text-secondary)',
  accepted: 'var(--color-text-secondary)',
  cancelled: 'var(--color-text-muted)',
  failed: 'rgba(184, 48, 48, 0.85)',
  dismissed: 'var(--color-text-muted)',
}

const NON_TERMINAL = new Set(['pending', 'running'])

export function SchedulerPanel({ projectId, documentId, documentName }: SchedulerPanelProps) {
  const [data, setData] = useState<QueuePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/scheduler/queue?document_id=${documentId}`, { cache: 'no-store' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      const body = (await res.json()) as { brief: BriefQueueState; jobs: AgentJobRow[] }
      setData({ brief: body.brief, jobs: body.jobs })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [documentId])

  // First-paint hydrate.
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Realtime — re-fetch on briefs / brief_stages / agent_jobs changes.
  // Coarse refresh (re-pull whole payload) keeps the wire format simple
  // for B.1.1; finer-grained patches are a polish item for later.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel(`scheduler:${documentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'briefs', filter: `document_id=eq.${documentId}` }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brief_stages' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_jobs', filter: `document_id=eq.${documentId}` }, () => void refresh())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [documentId, refresh])

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>Loading scheduler queue…</div>
  }
  if (error) {
    return <div role="alert" style={{ padding: 24, color: 'var(--color-text-primary)', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>Could not load queue: {error}</div>
  }
  if (!data) {
    return <div style={{ padding: 24, color: 'var(--color-text-muted)' }}>No data.</div>
  }

  const { brief, jobs } = data

  return (
    <div data-testid="scheduler-panel" style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', padding: '24px 32px', maxWidth: 980, margin: '0 auto', color: 'var(--color-text-primary)' }}>
      <div style={{ marginBottom: 24 }}>
        <a href={`/projects/${projectId}/documents/${documentId}`} style={{ fontSize: 12, color: 'var(--color-text-secondary)', textDecoration: 'none' }}>← {documentName}</a>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: '8px 0 4px' }}>Scheduler</h1>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {brief.active ? '1 active Brief' : 'No active Brief'} · {brief.queue.length} queued · {jobs.length} agent jobs
        </div>
      </div>

      <Section label="Active Brief">
        {brief.active ? (
          <BriefRow brief={brief.active} kind="active" projectId={projectId} documentId={documentId} onChange={() => void refresh()} />
        ) : (
          <Empty>No active Brief on this document.</Empty>
        )}
      </Section>

      <Section label={`Queued Briefs (${brief.queue.length})`}>
        {brief.queue.length === 0 ? (
          <Empty>Queue empty.</Empty>
        ) : (
          <ul data-testid="scheduler-queue-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {brief.queue.map((b, idx) => (
              <BriefRow
                key={b.brief_id}
                brief={b}
                kind="queued"
                projectId={projectId}
                documentId={documentId}
                queuePosition={idx}
                queueLength={brief.queue.length}
                queuedIds={brief.queue.map((q) => q.brief_id)}
                onChange={() => void refresh()}
              />
            ))}
          </ul>
        )}
      </Section>

      <Section label={`Agent jobs (${jobs.length})`}>
        {jobs.length === 0 ? (
          <Empty>No agent jobs on this document.</Empty>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {jobs.map((j) => (
              <JobRow key={j.id} job={j} onChange={() => void refresh()} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)', margin: '0 0 8px' }}>{label}</h2>
      <div style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 8, background: 'var(--color-bg-base)' }}>
        {children}
      </div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: '12px 16px', fontSize: 12, color: 'var(--color-text-muted)' }}>{children}</div>
}

interface BriefRowProps {
  brief: { brief_id: string; goal_text: string; status: string; sequence_position?: number; cause?: string }
  kind: 'active' | 'queued'
  projectId: string
  documentId: string
  queuePosition?: number
  queueLength?: number
  queuedIds?: string[]
  onChange: () => void
}

function BriefRow({ brief, kind, documentId, queuePosition, queueLength, queuedIds, onChange }: BriefRowProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function cancel() {
    setBusy('cancel')
    try {
      const res = await fetch(`/api/brief/${brief.brief_id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'cancelled_via_scheduler' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        alert(`Cancel failed: ${body?.message ?? res.status}`)
        return
      }
      setConfirming(false)
      onChange()
    } finally {
      setBusy(null)
    }
  }

  async function reorder(direction: 'up' | 'down') {
    if (!queuedIds || queuePosition === undefined) return
    const newIds = [...queuedIds]
    const target = direction === 'up' ? queuePosition - 1 : queuePosition + 1
    if (target < 0 || target >= newIds.length) return
    const tmp = newIds[queuePosition]
    newIds[queuePosition] = newIds[target]
    newIds[target] = tmp

    setBusy('reorder')
    try {
      const res = await fetch('/api/brief/queue/reorder', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ document_id: documentId, ordered_brief_ids: newIds }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        alert(`Reorder failed: ${body?.message ?? res.status}`)
        return
      }
      onChange()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="scheduler-brief-row" data-status={brief.status} data-brief-id={brief.brief_id} style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{brief.goal_text}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {kind === 'active' ? 'Active' : `Queued · position ${(queuePosition ?? 0) + 1}`}
          {brief.cause === 'sequence_promotion' ? ' · promoted from queue' : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {kind === 'queued' && queueLength !== undefined && queuedIds !== undefined ? (
          <>
            <button type="button" data-testid="reorder-up" disabled={queuePosition === 0 || busy !== null} onClick={() => void reorder('up')} style={iconBtnStyle} aria-label="Move up">↑</button>
            <button type="button" data-testid="reorder-down" disabled={queuePosition === queueLength - 1 || busy !== null} onClick={() => void reorder('down')} style={iconBtnStyle} aria-label="Move down">↓</button>
          </>
        ) : null}
        {confirming ? (
          <>
            <button type="button" data-testid="cancel-confirm" onClick={() => void cancel()} disabled={busy !== null} style={dangerBtnStyle}>
              {busy === 'cancel' ? 'Cancelling…' : 'Confirm cancel'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} style={ghostBtnStyle}>Keep</button>
          </>
        ) : (
          <button type="button" data-testid="cancel-trigger" onClick={() => setConfirming(true)} disabled={busy !== null} style={ghostBtnStyle}>
            Cancel
          </button>
        )}
      </div>
    </div>
  )
}

function JobRow({ job, onChange }: { job: AgentJobRow; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const cancellable = NON_TERMINAL.has(job.status)

  async function cancel() {
    setBusy('cancel')
    try {
      const res = await fetch(`/api/scheduler/jobs/${job.id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'cancelled_via_scheduler' }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        alert(`Cancel failed: ${body?.message ?? res.status}`)
        return
      }
      onChange()
    } finally {
      setBusy(null)
    }
  }

  async function changeIntent(next: 'immediate' | 'scheduled' | 'parked') {
    if (next === job.execution_intent) return
    setBusy('intent')
    try {
      const res = await fetch(`/api/scheduler/jobs/${job.id}/intent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ execution_intent: next }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        alert(`Intent change failed: ${body?.message ?? res.status}`)
        return
      }
      onChange()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="scheduler-job-row" data-status={job.status} data-job-id={job.id} style={rowStyle}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>{job.operation_type}</span>
          <span style={{ marginLeft: 8, color: JOB_STATUS_COLOUR[job.status] ?? 'var(--color-text-secondary)' }}>{job.status}</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
          intent: {job.execution_intent} · class {job.traffic_class} · route {job.route}
          {job.scheduled_at ? ` · scheduled ${new Date(job.scheduled_at).toLocaleString()}` : null}
          {job.cause ? ` · cause: ${job.cause}` : null}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {cancellable ? (
          <select
            data-testid="job-intent-select"
            value={job.execution_intent}
            onChange={(e) => void changeIntent(e.target.value as 'immediate' | 'scheduled' | 'parked')}
            disabled={busy !== null}
            style={selectStyle}
          >
            <option value="immediate">Immediate</option>
            <option value="scheduled">Scheduled</option>
            <option value="parked">Parked</option>
          </select>
        ) : null}
        {cancellable ? (
          <button type="button" data-testid="job-cancel" onClick={() => void cancel()} disabled={busy !== null} style={ghostBtnStyle}>
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderBottom: '1px solid var(--color-border-subtle)',
}
const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-strong)',
  color: 'var(--color-text-primary)',
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}
const dangerBtnStyle: React.CSSProperties = {
  ...ghostBtnStyle,
  borderColor: 'rgba(184,48,48,0.6)',
  color: 'rgba(184,48,48,0.95)',
}
const iconBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text-secondary)',
  width: 26,
  height: 26,
  borderRadius: 4,
  fontSize: 12,
  cursor: 'pointer',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}
const selectStyle: React.CSSProperties = {
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-subtle)',
  color: 'var(--color-text-primary)',
  padding: '5px 8px',
  borderRadius: 4,
  fontSize: 12,
  fontFamily: 'var(--font-inter), Inter, sans-serif',
}
