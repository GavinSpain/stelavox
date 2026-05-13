'use client'

// V1.x-A.1 — renders a <profile_amendment_proposal> artefact in the
// DirectorPanel conversation thread. Was BriefAmendmentCard in V1.x-A.
//
// Inviolable #2: Approve button uses verdigris #7 (affirmative-action).

import { useState } from 'react'

import type { ProfileAmendmentProposalParsed } from '@/lib/director/schemas'

interface ProjectProfileAmendmentCardProps {
  profileId: string
  amendment: ProfileAmendmentProposalParsed
  onApproved?: () => void
}

const TYPE_LABEL: Record<string, string> = {
  update_goal_text: 'Update project goal',
  update_voice: 'Update voice',
  add_constraint: 'Add constraint',
  update_constraints: 'Update constraints',
  add_decision: 'Add decision',
  update_decisions: 'Update decisions',
  update_named_entities: 'Update named entities',
  generic_preferences_set: 'Set preference',
}

export function ProjectProfileAmendmentCard({ profileId, amendment, onApproved }: ProjectProfileAmendmentCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function approve() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/profile/amendments/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, amendment }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      setDone(true)
      onApproved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div data-testid="profile-amendment-card" data-state="approved" style={{ ...cardStyle, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Profile amendment approved.</span>
      </div>
    )
  }

  return (
    <div data-testid="profile-amendment-card" data-state="draft" style={cardStyle}>
      <div style={headerStyle}>
        Proposed Profile Amendment — {TYPE_LABEL[amendment.amendment_type] ?? amendment.amendment_type}
      </div>

      <div style={{ padding: '12px 14px' }}>
        {amendment.target_path ? (
          <Row label="Path"><code style={codeStyle}>{amendment.target_path}</code></Row>
        ) : null}
        <Row label="New value">
          <pre style={{ ...codeStyle, padding: '6px 8px', maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {formatAfter(amendment.after)}
          </pre>
        </Row>
        <Row label="Reason">
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{amendment.reason}</span>
        </Row>

        {error ? (
          <div role="alert" style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(184,48,48,0.08)', border: '1px solid rgba(184,48,48,0.25)', borderRadius: 4, fontSize: 12, color: 'var(--color-text-primary)' }}>
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button
            type="button"
            data-testid="profile-amendment-approve"
            disabled={submitting}
            onClick={() => void approve()}
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
              fontFamily: 'var(--font-inter), Inter, sans-serif',
            }}
          >
            {submitting ? 'Approving…' : 'Approve amendment'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 6, alignItems: 'flex-start' }}>
      <span style={{ minWidth: 80, fontSize: 11, color: 'var(--color-text-muted)', paddingTop: 2, fontFamily: 'var(--font-inter), Inter, sans-serif' }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  )
}

function formatAfter(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
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
  color: 'var(--color-text-secondary)',
}
const codeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono), ui-monospace, monospace',
  fontSize: 11,
  background: 'var(--color-bg-elevated, rgba(255,255,255,0.04))',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 4,
  margin: 0,
  padding: '2px 6px',
}
