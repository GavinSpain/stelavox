'use client'

// Spec: stelavox_v1x_b_3_build_checklist_v1_0.md §4
//       Director Architecture v2.3 §6 (Brief amendments)
//
// Renders in the conversation thread when iteration-runner emits a
// brief_amendment_proposal artefact. Single Approve button (verdigris
// use #7 — affirmative-action triggers family; no broadening).
// Single Reject button (text-only, neutral).
//
// Inviolable #2 audit: Approve button background = --color-accent;
// falls under existing use #7 (affirmative-action triggers — Brief
// amendments are a family member alongside BriefProposalCard Approve,
// BriefCancellationProposalCard Approve, ProjectProfileAmendmentCard
// Approve, etc.). Verdigris-use count remains nine.

import { useState } from 'react'

interface BriefAmendmentCardProps {
  amendmentId?: string  // optional pre-persisted id (Director path); when null, the card POSTs to /propose first
  proposal: {
    brief_id: string
    amendment_type: 'goal_text' | 'preferences' | 'add_stage' | 'modify_pending_stage' | 'remove_pending_stage'
    target_path?: string | null
    before?: Record<string, unknown> | null
    after: Record<string, unknown>
    reason: string
  }
  onApproved?: () => void
  onRejected?: () => void
}

const AMENDMENT_LABEL: Record<BriefAmendmentCardProps['proposal']['amendment_type'], string> = {
  goal_text: 'Update goal',
  preferences: 'Update preferences',
  add_stage: 'Add stage',
  modify_pending_stage: 'Modify pending stage',
  remove_pending_stage: 'Remove pending stage',
}

export function BriefAmendmentCard({ amendmentId: initialId, proposal, onApproved, onRejected }: BriefAmendmentCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<'approved' | 'rejected' | null>(null)

  async function handleApprove() {
    setSubmitting(true)
    setError(null)
    try {
      let amendmentId = initialId
      if (!amendmentId) {
        const proposeRes = await fetch('/api/brief/amendments/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proposal),
        })
        if (!proposeRes.ok) {
          const body = (await proposeRes.json().catch(() => null)) as { message?: string; error?: string } | null
          setError(body?.message ?? body?.error ?? `Propose failed (${proposeRes.status})`)
          return
        }
        const proposeBody = (await proposeRes.json()) as { amendment_id: string }
        amendmentId = proposeBody.amendment_id
      }
      const res = await fetch(`/api/brief/amendments/${amendmentId}/approve`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Approve failed (${res.status})`)
        return
      }
      setDone('approved')
      onApproved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    setSubmitting(true)
    setError(null)
    try {
      let amendmentId = initialId
      if (!amendmentId) {
        const proposeRes = await fetch('/api/brief/amendments/propose', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(proposal),
        })
        if (!proposeRes.ok) {
          setDone('rejected')
          onRejected?.()
          return
        }
        const proposeBody = (await proposeRes.json()) as { amendment_id: string }
        amendmentId = proposeBody.amendment_id
      }
      const res = await fetch(`/api/brief/amendments/${amendmentId}/reject`, { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Reject failed (${res.status})`)
        return
      }
      setDone('rejected')
      onRejected?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div
        data-testid="brief-amendment-card"
        data-state={done}
        style={{
          padding: '8px 12px',
          background: 'transparent',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 6,
          fontSize: 11,
          color: 'var(--color-text-muted)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
        }}
      >
        {done === 'approved' ? 'Amendment approved.' : 'Amendment rejected.'}
      </div>
    )
  }

  const renderDiff = () => {
    if (proposal.amendment_type === 'goal_text') {
      const newGoal = String(proposal.after?.goal_text ?? '')
      return (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          <span style={{ color: 'var(--color-text-muted)' }}>New goal: </span>
          <span style={{ color: 'var(--color-text-primary)' }}>{newGoal}</span>
        </div>
      )
    }
    if (proposal.amendment_type === 'add_stage') {
      const order = String(proposal.after?.order ?? '?')
      const title = String(proposal.after?.title ?? '?')
      return (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          Add stage <strong>{order}</strong>: {title}
        </div>
      )
    }
    if (proposal.amendment_type === 'remove_pending_stage') {
      return (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          Remove pending stage <code>{proposal.target_path}</code>
        </div>
      )
    }
    // Generic fallback for preferences + modify_pending_stage
    return (
      <pre style={{ fontSize: 10, color: 'var(--color-text-muted)', marginBottom: 8, overflowX: 'auto', fontFamily: 'monospace' }}>
        {JSON.stringify(proposal.after, null, 2)}
      </pre>
    )
  }

  return (
    <div
      data-testid="brief-amendment-card"
      data-amendment-type={proposal.amendment_type}
      style={{
        padding: '12px 14px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 6,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>Brief amendment</span>
        <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-primary)' }}>{AMENDMENT_LABEL[proposal.amendment_type]}</span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8, lineHeight: 1.4 }}>
        {proposal.reason}
      </div>

      {renderDiff()}

      {error ? (
        <div role="alert" style={{ padding: '6px 10px', background: 'rgba(184,48,48,0.08)', border: '1px solid rgba(184,48,48,0.25)', borderRadius: 4, fontSize: 11, color: 'var(--color-text-primary)', marginBottom: 8 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          data-testid="brief-amendment-approve"
          disabled={submitting}
          onClick={() => void handleApprove()}
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-bg-base)',
            border: 'none',
            padding: '6px 14px',
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 500,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          data-testid="brief-amendment-reject"
          disabled={submitting}
          onClick={() => void handleReject()}
          style={{
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-subtle)',
            padding: '6px 14px',
            borderRadius: 4,
            fontSize: 12,
            cursor: submitting ? 'wait' : 'pointer',
            opacity: submitting ? 0.7 : 1,
          }}
        >
          Reject
        </button>
      </div>
    </div>
  )
}
