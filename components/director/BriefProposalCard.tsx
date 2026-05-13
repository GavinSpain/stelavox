'use client'

// V1.x-A.1 — operation-level Brief proposal.
// Renders a <brief_proposal> artefact in the DirectorPanel conversation
// thread. The proposal shape now includes:
//   - goal_text (operation description)
//   - stages (1+, n=1 is trivial)
//     - stage 1's workflow is fully specified
//     - stages 2..N have workflow:null (just-in-time planning)
//
// Inviolable #2: Approve button = verdigris #7 (affirmative-action).

import { useState } from 'react'

import type { BriefProposalV1xA1Parsed } from '@/lib/director/schemas'

interface BriefProposalCardProps {
  documentId: string
  proposal: BriefProposalV1xA1Parsed
  onApproved?: () => void
}

const TRIGGER_LABEL: Record<string, string> = {
  after_stage: 'After previous',
  scheduled_at: 'Scheduled',
  manual: 'Manual',
  compound: 'Compound',
}

export function BriefProposalCard({ documentId, proposal, onApproved }: BriefProposalCardProps) {
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
        body: JSON.stringify({ document_id: documentId, proposal }),
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
      <div data-testid="brief-proposal-card" data-state="approved" style={{ ...cardStyle, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Brief approved.</span>
      </div>
    )
  }

  const trivial = proposal.stages.length === 1
  const stage1 = proposal.stages.find((s) => s.order === 1)

  return (
    <div data-testid="brief-proposal-card" data-state="draft" data-stage-count={proposal.stages.length} style={cardStyle}>
      <div style={headerStyle}>{trivial ? 'Proposed Brief (single stage)' : `Proposed Brief — ${proposal.stages.length} stages`}</div>

      <div style={{ padding: '12px 14px' }}>
        <SectionLabel>Goal</SectionLabel>
        <div style={{ fontSize: 14, color: 'var(--color-text-primary)', lineHeight: 1.5, marginBottom: 12 }}>
          {proposal.goal_text}
        </div>

        {trivial && stage1?.workflow ? (
          <>
            <SectionLabel>Steps ({stage1.workflow.steps.length})</SectionLabel>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 12 }}>
              {stage1.workflow.steps.map((step, idx) => (
                <li key={idx} data-testid="brief-proposal-step" style={stepStyle}>
                  <span style={{ minWidth: 22, fontSize: 11, color: 'var(--color-text-muted)' }}>{idx + 1}.</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{step.operation_type}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{step.description}</div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <SectionLabel>Stages ({proposal.stages.length})</SectionLabel>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none', marginBottom: 12 }}>
              {proposal.stages.map((s) => (
                <li key={s.order} data-testid="brief-proposal-stage" style={stageStyle}>
                  <span style={{ minWidth: 22, fontSize: 11, color: 'var(--color-text-muted)' }}>{s.order}.</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 13 }}>{s.title}</div>
                    {s.description ? (
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{s.description}</div>
                    ) : null}
                    <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {TRIGGER_LABEL[s.trigger_type] ?? s.trigger_type}
                      {s.order === 1
                        ? ` · ${s.workflow ? `${s.workflow.steps.length} steps planned` : 'workflow planned'}`
                        : ' · workflow planned just-in-time when this stage activates'}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}

        {error ? (
          <div role="alert" style={errorStyle}>{error}</div>
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
    <div style={{ fontFamily: 'var(--font-inter), Inter, sans-serif', fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: 'var(--color-text-muted)', marginBottom: 6 }}>
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
const stageStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '8px 8px',
  borderBottom: '1px solid var(--color-border-subtle)',
  fontSize: 12,
  color: 'var(--color-text-primary)',
}
const stepStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  padding: '6px 8px',
  borderBottom: '1px solid var(--color-border-subtle)',
  fontSize: 12,
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
