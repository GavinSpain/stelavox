'use client'

// Spec: V1.x-A build checklist §3.6 T-6.3
//       Director Architecture v2.0 §6 (BriefProposal artefact)
//
// Renders a <brief_proposal> artefact in the DirectorPanel conversation
// thread. Analogous to PlanCard but for project-level Brief proposals.
//
// Inviolable #2: the Approve button uses --color-accent as use #7
// (affirmative-action trigger). No other accent uses in this file.

import { useState } from 'react'

import type { BriefProposalParsed } from '@/lib/director/schemas'

interface BriefProposalCardProps {
  briefId: string
  proposal: BriefProposalParsed
  onApproved?: () => void
}

const TRIGGER_LABEL: Record<string, string> = {
  after_stage: 'After previous',
  scheduled_at: 'Scheduled',
  manual: 'Manual',
  compound: 'Compound',
}

export function BriefProposalCard({ briefId, proposal, onApproved }: BriefProposalCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function approve() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/brief/proposals/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ brief_id: briefId, proposal }),
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
      <div
        data-testid="brief-proposal-card"
        data-state="approved"
        style={{ ...cardStyle, padding: '10px 14px' }}
      >
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Brief approved.</span>
      </div>
    )
  }

  const voice = typeof proposal.preferences.voice === 'string' ? proposal.preferences.voice : null
  const constraints = (proposal.preferences.constraints as unknown[] | undefined)?.filter(
    (s): s is string => typeof s === 'string',
  )
  const decisions = (proposal.preferences.decisions as unknown[] | undefined)?.filter(
    (s): s is string => typeof s === 'string',
  )

  return (
    <div data-testid="brief-proposal-card" data-state="draft" style={cardStyle}>
      <div style={headerStyle}>Proposed Project Brief</div>

      <div style={{ padding: '12px 14px' }}>
        <SectionLabel>Goal</SectionLabel>
        <div
          style={{
            fontSize: 14,
            color: 'var(--color-text-primary)',
            lineHeight: 1.5,
            marginBottom: 12,
          }}
        >
          {proposal.goal_text}
        </div>

        {(voice || (constraints && constraints.length) || (decisions && decisions.length)) ? (
          <div style={{ marginBottom: 12 }}>
            <SectionLabel>Preferences</SectionLabel>
            {voice ? <Row label="Voice">{voice}</Row> : null}
            {constraints && constraints.length ? (
              <Row label="Constraints">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {constraints.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </Row>
            ) : null}
            {decisions && decisions.length ? (
              <Row label="Decisions">
                <ul style={{ margin: 0, paddingLeft: 16 }}>
                  {decisions.map((d, i) => <li key={i}>{d}</li>)}
                </ul>
              </Row>
            ) : null}
          </div>
        ) : null}

        <SectionLabel>Stages ({proposal.stages.length})</SectionLabel>
        <ol style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 12 }}>
          {proposal.stages.map((s) => (
            <li
              key={s.order}
              data-testid="brief-proposal-stage"
              style={{
                padding: '6px 8px',
                fontSize: 12,
                color: 'var(--color-text-primary)',
                display: 'flex',
                gap: 8,
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span
                aria-hidden
                style={{
                  minWidth: 18,
                  color: 'var(--color-text-muted)',
                }}
              >
                {s.order}.
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500 }}>{s.title}</div>
                {s.description ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.4,
                    }}
                  >
                    {s.description}
                  </div>
                ) : null}
                <div
                  style={{
                    marginTop: 2,
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {TRIGGER_LABEL[s.trigger_type] ?? s.trigger_type}
                </div>
              </div>
            </li>
          ))}
        </ol>

        {error ? (
          <div
            role="alert"
            style={{
              padding: '8px 12px',
              background: 'rgba(184,48,48,0.08)',
              border: '1px solid rgba(184,48,48,0.25)',
              borderRadius: 4,
              fontSize: 12,
              color: 'var(--color-text-primary)',
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="brief-proposal-approve"
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
            {submitting ? 'Approving…' : 'Approve Brief'}
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 12, marginBottom: 4, alignItems: 'baseline' }}>
      <span style={{ minWidth: 90, fontSize: 11, color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--color-text-primary)' }}>{children}</span>
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
