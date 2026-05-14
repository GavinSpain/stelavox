'use client'

/**
 * V1.x-B.1.1 — destructive Brief cancellation proposal card.
 *
 * Renders a brief_cancellation_proposal artefact in the DirectorPanel
 * conversation thread. The Director recommends cancelling a specific
 * Brief; the user approves here before the cancel_brief RPC fires
 * (per H-08 — write tools never execute inside the agentic loop).
 *
 * On mount, asks the server for the Brief's current status to decide
 * whether to render the Approve button (Brief still cancellable) or
 * the post-cancellation state (Brief already terminal). Closes the
 * conversation-replay bug where re-rendering would show Approve on
 * an already-cancelled Brief.
 *
 * Inviolable #2: Approve button = verdigris use #7 (affirmative-action
 * triggers — same family as other write-proposal Approves).
 */

import { useEffect, useState } from 'react'

import type { BriefCancellationProposalArtefact } from '@/lib/director/types'
import type { CancelBriefResult } from '@/lib/brief/types'

interface BriefCancellationProposalCardProps {
  proposal: BriefCancellationProposalArtefact
  onApproved?: (result: CancelBriefResult) => void
}

interface BriefStatusLookup {
  status: 'planned' | 'queued' | 'active' | 'completed' | 'cancelled'
  goal_text: string
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  queued: 'Queued',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function BriefCancellationProposalCard({
  proposal,
  onApproved,
}: BriefCancellationProposalCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<CancelBriefResult | null>(null)
  const [briefStatus, setBriefStatus] = useState<BriefStatusLookup | null>(null)
  const [lookupLoading, setLookupLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/brief/${proposal.brief_id}`)
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as { status?: string; goal_text?: string } | null
          if (!cancelled && body && typeof body.status === 'string' && typeof body.goal_text === 'string') {
            setBriefStatus({
              status: body.status as BriefStatusLookup['status'],
              goal_text: body.goal_text,
            })
          }
        }
      } catch {
        // Network error — fall through; render as draft (allow user to attempt approval)
      } finally {
        if (!cancelled) setLookupLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [proposal.brief_id])

  async function approve() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/brief/${proposal.brief_id}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: proposal.reason }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      const result = (await res.json()) as CancelBriefResult
      setDone(result)
      onApproved?.(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (lookupLoading) {
    return (
      <div data-testid="brief-cancellation-proposal-card" data-state="loading" style={{ ...cardStyle, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading Brief state…</span>
      </div>
    )
  }

  // If the Brief is already terminal (or we just cancelled it), show
  // the resulting state instead of an Approve button.
  if (done || (briefStatus && (briefStatus.status === 'completed' || briefStatus.status === 'cancelled'))) {
    const status = done ? 'cancelled' : briefStatus!.status
    return (
      <div data-testid="brief-cancellation-proposal-card" data-state={status} data-brief-id={proposal.brief_id} style={cardStyle}>
        <div style={headerStyle}>Cancellation — {STATUS_LABEL[status]}</div>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 6 }}>
            {done ? (
              <>
                Brief cancelled. {done.cancelled_count} pending stages cancelled, {done.completed_count} completed retained.
                {done.promoted_brief_id ? ' The next queued Brief is now active.' : ''}
              </>
            ) : (
              <>This Brief is no longer active. No cancellation needed.</>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="brief-cancellation-proposal-card" data-state="draft" data-brief-id={proposal.brief_id} style={cardStyle}>
      <div style={headerStyle}>Proposed Cancellation</div>

      <div style={{ padding: '12px 14px' }}>
        <SectionLabel>Brief</SectionLabel>
        <div style={{ fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 12 }}>
          {briefStatus?.goal_text ?? proposal.brief_id}
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
            {STATUS_LABEL[proposal.brief_status_at_proposal] ?? proposal.brief_status_at_proposal}
          </span>
        </div>

        <SectionLabel>Reason</SectionLabel>
        <div style={{ fontSize: 13, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 12 }}>
          {proposal.reason}
        </div>

        <SectionLabel>Cascade preview</SectionLabel>
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 12 }}>
          <li style={cascadeRowStyle}>
            <span style={cascadeLabelStyle}>Pending stages cancelled</span>
            <span style={cascadeValueStyle} data-testid="cascade-pending-stages">
              {proposal.cascade_preview.pending_stages}
            </span>
          </li>
          <li style={cascadeRowStyle}>
            <span style={cascadeLabelStyle}>Completed stages retained</span>
            <span style={cascadeValueStyle} data-testid="cascade-completed-stages">
              {proposal.cascade_preview.completed_stages}
            </span>
          </li>
          {proposal.cascade_preview.queued_brief_will_promote ? (
            <li style={cascadeRowStyle} data-testid="cascade-promote-notice">
              <span style={cascadeLabelStyle}>Next queued Brief will activate</span>
              <span style={{ ...cascadeValueStyle, color: 'var(--color-text-primary)' }}>Yes</span>
            </li>
          ) : null}
        </ul>

        {error ? (
          <div role="alert" style={errorStyle}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="brief-cancellation-approve"
            disabled={submitting}
            onClick={() => void approve()}
            style={{
              background: 'var(--color-accent)',
              color: 'var(--color-bg-base)',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 500,
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting ? 0.7 : 1,
              fontFamily: 'var(--font-inter), Inter, sans-serif',
            }}
          >
            {submitting ? 'Cancelling…' : 'Approve cancellation'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 500,
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        color: 'var(--color-text-muted)',
        marginBottom: 6,
      }}
    >
      {children}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 8,
  margin: '8px 0',
}
const headerStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--color-border-subtle)',
  fontWeight: 500,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--color-text-secondary)',
}
const cascadeRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  fontSize: 12,
}
const cascadeLabelStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
}
const cascadeValueStyle: React.CSSProperties = {
  fontWeight: 500,
  color: 'var(--color-text-primary)',
}
const errorStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'rgba(184,48,48,0.08)',
  border: '1px solid rgba(184,48,48,0.25)',
  borderRadius: 4,
  fontSize: 12,
  color: 'var(--color-text-primary)',
  marginBottom: 10,
}
