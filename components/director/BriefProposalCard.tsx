'use client'

// V1.x-A.1 — operation-level Brief proposal.
// Renders a <brief_proposal> artefact in the DirectorPanel conversation
// thread. The proposal shape now includes:
//   - goal_text (operation description)
//   - stages (1+, n=1 is trivial)
//     - stage 1's workflow is fully specified
//     - stages 2..N have workflow:null (just-in-time planning)
//
// On mount the card asks the server whether a Brief has already been
// created from this proposal (matched by goal_text per
// GET /api/documents/[id]/brief-for-proposal). If so, it renders the
// Brief's current state instead of an Approve button — closes the bug
// where re-rendering the conversation thread (e.g. after a page reload)
// showed an Approve button on already-approved proposals.
//
// Inviolable #2: Approve button = verdigris #7 (affirmative-action).

import { useEffect, useState } from 'react'

import type { BriefProposalV1xA1Parsed } from '@/lib/director/schemas'

interface BriefProposalCardProps {
  documentId: string
  proposal: BriefProposalV1xA1Parsed
  /**
   * V1.x-D.4 — when set, renders a warning block + the Approve button
   * label swaps to "Approve anyway". Attached to the artefact by
   * execProposeBrief in V1.x-B.3; surfaced via findProposalInToolCalls.
   */
  concurrentEditWarning?: {
    node_ids: string[]
    conflicting_brief_ids: string[]
    message: string
  } | null
  onApproved?: () => void
}

// 2026-05-21 simplification (M-183): trigger_type narrowed.
const TRIGGER_LABEL: Record<string, string> = {
  after_stage: 'After previous',
  manual: 'Manual',
}

const STATUS_LABEL: Record<string, string> = {
  planned: 'Planned',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

interface ExistingBrief {
  id: string
  status: 'planned' | 'active' | 'completed' | 'cancelled'
  current_stage: { order: number; title: string; status: string } | null
}

export function BriefProposalCard({
  documentId,
  proposal,
  concurrentEditWarning,
  onApproved,
}: BriefProposalCardProps) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [existingBrief, setExistingBrief] = useState<ExistingBrief | null>(null)
  const [lookupLoading, setLookupLoading] = useState(true)
  // V1.x-B.2.3 — auto-approve subsequent stages. Sets briefs.auto_approve_workflow_proposals
  // on creation; the iteration-runner then auto-approves any workflow_proposal
  // it emits in subsequent stages of this Brief.
  const [autoApproveSubsequent, setAutoApproveSubsequent] = useState(false)

  // Reject / dismiss state. Tracked client-side via localStorage so the
  // proposal artefact persists in the conversation_messages row (no DB
  // mutation — the user might want to scroll back and see what was
  // proposed) but the card collapses to a one-line dismissed note.
  // Key uses the proposal goal_text as a stable identifier (same shape
  // the brief-for-proposal lookup uses).
  const dismissKey = `brief-proposal-dismissed:${documentId}:${proposal.goal_text}`
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(dismissKey) === '1'
  })

  // On mount, ask the server whether a Brief has already been created
  // from this proposal. If so, render the Brief's current state instead
  // of the Approve button.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const url = `/api/documents/${documentId}/brief-for-proposal?goal_text=${encodeURIComponent(proposal.goal_text)}`
        const res = await fetch(url)
        if (cancelled) return
        if (res.ok) {
          const body = (await res.json()) as { brief: ExistingBrief | null }
          if (!cancelled) setExistingBrief(body.brief)
        }
      } catch {
        // Network error — fall through; card renders as draft (allow user to retry approval)
      } finally {
        if (!cancelled) setLookupLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [documentId, proposal.goal_text])

  function dismiss() {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(dismissKey, '1')
    }
    setDismissed(true)
  }

  async function approve() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/brief/proposals/approve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          document_id: documentId,
          proposal,
          auto_approve_workflow_proposals: autoApproveSubsequent,
        }),
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

  // Dismissed state — user clicked Reject. Collapse to a one-line note
  // so the conversation thread doesn't keep showing a stale proposal but
  // the author can still see what was proposed earlier on scroll-back.
  if (dismissed && !existingBrief) {
    return (
      <div
        data-testid="brief-proposal-card"
        data-state="dismissed"
        style={{ ...cardStyle, padding: '8px 14px' }}
      >
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Brief proposal dismissed.
        </span>
      </div>
    )
  }

  // Loading state — keep card minimal until we know whether to show
  // Approve button or the approved state. Prevents flicker.
  if (lookupLoading) {
    return (
      <div data-testid="brief-proposal-card" data-state="loading" style={{ ...cardStyle, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Loading Brief state…</span>
      </div>
    )
  }

  // If a Brief was already created from this proposal, render its
  // current state instead of an Approve button.
  if (existingBrief || done) {
    const status = existingBrief?.status ?? 'active'
    const currentStage = existingBrief?.current_stage
    return (
      <div
        data-testid="brief-proposal-card"
        data-state={status}
        data-brief-id={existingBrief?.id}
        style={cardStyle}
      >
        <div style={headerStyle}>Brief — {STATUS_LABEL[status]}</div>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-primary)', marginBottom: 8 }}>
            {proposal.goal_text}
          </div>
          {currentStage ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Current stage: <strong>{currentStage.order}. {currentStage.title}</strong> — {currentStage.status}
            </div>
          ) : status === 'completed' ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>All stages completed.</div>
          ) : status === 'cancelled' ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Brief cancelled.</div>
          ) : null}
        </div>
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
                    {/* 2026-05-21 simplification — stage is either
                        workflow-bound (concrete steps planned now)
                        or prompt-deferred (system plans when trigger
                        fires). Render the prompt when present so the
                        author sees what's queued for later. */}
                    {s.prompt ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--color-text-secondary)',
                          lineHeight: 1.4,
                          fontStyle: 'italic',
                          marginTop: 2,
                        }}
                        data-testid="brief-proposal-stage-prompt"
                      >
                        Prompt: “{s.prompt}”
                      </div>
                    ) : null}
                    <div style={{ marginTop: 2, fontSize: 10, color: 'var(--color-text-muted)' }}>
                      {TRIGGER_LABEL[s.trigger_type] ?? s.trigger_type}
                      {s.workflow
                        ? ` · ${s.workflow.steps.length} steps planned`
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

        {/* V1.x-B.2.3 — auto-approve subsequent stages (only meaningful for
            multi-stage Briefs). Inviolable #2: checkbox uses verdigris ONLY
            in its checked state, falling under existing use #7 (affirmative-
            action triggers — auto-approve commitment fits the family). */}
        {proposal.stages.length > 1 ? (
          <label
            data-testid="brief-proposal-auto-approve-checkbox-label"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              marginBottom: 12,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              data-testid="brief-proposal-auto-approve-checkbox"
              checked={autoApproveSubsequent}
              onChange={(e) => setAutoApproveSubsequent(e.target.checked)}
              disabled={submitting}
              style={{
                accentColor: autoApproveSubsequent ? 'var(--color-accent)' : undefined,
                cursor: 'pointer',
              }}
            />
            <span>
              Auto-approve subsequent stages
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)', marginLeft: 6 }}>
                (Director plans + runs each stage without further approval)
              </span>
            </span>
          </label>
        ) : null}

        {/* V1.x-D.4 — concurrent-edit warning block. Renders when the
            Director-attached artefact carries a concurrent_edit_warning
            (V1.x-B.3 contract). The Approve button copy swaps below. */}
        {concurrentEditWarning ? (
          <div
            data-testid="brief-proposal-concurrent-edit-warning"
            role="status"
            style={{
              background: 'rgba(184,112,48,0.10)',
              borderLeft: '2px solid var(--color-status-review)',
              borderRadius: 4,
              padding: '10px 12px',
              margin: '12px 0',
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.55,
            }}
          >
            <div
              style={{
                color: 'var(--color-status-review)',
                fontWeight: 500,
                marginBottom: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              ⚠ Concurrent-edit warning
            </div>
            <div>{concurrentEditWarning.message}</div>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)' }}>
              Recommended: wait for the conflicting Brief
              {concurrentEditWarning.conflicting_brief_ids.length === 1 ? '' : 's'} to complete,
              or cancel
              {concurrentEditWarning.conflicting_brief_ids.length === 1 ? ' it' : ' them'} first.
            </div>
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            data-testid="brief-proposal-approve"
            data-concurrent-edit={concurrentEditWarning ? 'true' : undefined}
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
            {submitting
              ? 'Approving…'
              : concurrentEditWarning
                ? 'Approve anyway'
                : 'Approve Brief'}
          </button>
          {/* Reject button — neutral ghost. Local-dismiss only; the
             proposal artefact stays in the message row so scroll-back
             still shows what the Director offered. NOT verdigris;
             rejection is not an affirmative-action trigger. */}
          <button
            type="button"
            data-testid="brief-proposal-reject"
            disabled={submitting}
            onClick={dismiss}
            style={{
              background: 'transparent',
              color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border-default)',
              padding: '8px 16px',
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 400,
              cursor: submitting ? 'not-allowed' : 'pointer',
              opacity: submitting ? 0.5 : 1,
              fontFamily: 'var(--font-inter), Inter, sans-serif',
            }}
          >
            Reject
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
