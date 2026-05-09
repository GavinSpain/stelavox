'use client'

// Spec: stelavox_component_specification_v2_7.md §7.7 (ExecutionCard)
//       stelavox_phase5b_api_contract_v1_0.md §3.8, §3.9, §3.10
//       stelavox_phase5b_build_checklist_v1_0.md §3.15 T-15.2
//       SU-42 (close-out spec amendment) — heartbeat indicator
//
// Replaces PlanCard once the workflow transitions out of `draft`.
// Read-only with control footer (Pause / Resume / Stop). Per-step icons
// + animations per the §7.7 state table. The heartbeat dot at the card
// header pulses while the workflow's last_heartbeat_at is fresh; goes
// stale (no pulse, muted) after 30s without a beat.

import { useEffect, useMemo, useState } from 'react'
import type { WorkflowDto, WorkflowStepDto } from '@/lib/hooks/useDirectorConversation'

interface ExecutionCardProps {
  workflow: WorkflowDto
  /** Optional: server-issued last_heartbeat_at ISO string. If omitted, heartbeat pulse is hidden. */
  lastHeartbeatAt?: string | null
  onUpdated?: (workflow: WorkflowDto) => void
}

const HEARTBEAT_FRESH_MS = 30_000

function operationLabel(t: string): string {
  switch (t) {
    case 'expand':           return 'Expand'
    case 'synthesise':       return 'Synthesise'
    case 'refine':           return 'Refine'
    case 'generate_context': return 'Generate context'
    case 'comment':          return 'Comment'
    case 'node_reorder':     return 'Reorder'
    default:                 return t
  }
}

function statusGlyph(s: WorkflowStepDto['status']): { icon: string; ariaLabel: string } {
  switch (s) {
    case 'pending':   return { icon: '◌', ariaLabel: 'pending' }
    case 'running':   return { icon: '⟳', ariaLabel: 'running' }
    case 'completed': return { icon: '✓', ariaLabel: 'completed' }
    case 'failed':    return { icon: '✗', ariaLabel: 'failed' }
    case 'skipped':   return { icon: '–', ariaLabel: 'skipped' }
    case 'removed':   return { icon: '–', ariaLabel: 'removed' }
  }
}

export function ExecutionCard({
  workflow,
  lastHeartbeatAt,
  onUpdated,
}: ExecutionCardProps) {
  const [submitting, setSubmitting] = useState<'pause' | 'resume' | 'stop' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visibleSteps = useMemo(
    () =>
      workflow.steps
        .slice()
        .filter((s) => s.status !== 'removed')
        .sort((a, b) => a.order - b.order),
    [workflow.steps],
  )

  const completedCount = visibleSteps.filter(
    (s) => s.status === 'completed' || s.status === 'failed' || s.status === 'skipped',
  ).length
  const runningStep = visibleSteps.find((s) => s.status === 'running')
  const currentStepNumber = runningStep
    ? runningStep.order
    : Math.min(completedCount + 1, visibleSteps.length)

  // Heartbeat freshness — re-evaluated on a tick.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    // Always tick — even without a heartbeat, the grace-window calc
    // depends on `now` advancing past workflow.created_at.
    const id = setInterval(() => setNow(Date.now()), 1500)
    return () => clearInterval(id)
  }, [])
  // SU-J14-4 (round-3 drive 2026-05-09): the indicator used to read as
  // "stalled" the instant the workflow was approved, before the
  // executor had a chance to write its first heartbeat. Authors saw
  // "stalled" on a workflow that was just-dispatched and assumed the
  // system was broken. Apply a HEARTBEAT_FRESH_MS grace window from
  // workflow.created_at — within that window, the indicator reads as
  // fresh regardless of whether last_heartbeat_at has been set yet.
  const ageMs = workflow.created_at
    ? now - new Date(workflow.created_at).getTime()
    : Infinity
  const inGraceWindow = ageMs >= 0 && ageMs < HEARTBEAT_FRESH_MS
  const heartbeatFresh = lastHeartbeatAt
    ? now - new Date(lastHeartbeatAt).getTime() < HEARTBEAT_FRESH_MS
    : inGraceWindow

  async function callTransition(verb: 'pause' | 'resume' | 'stop') {
    if (submitting) return
    setSubmitting(verb)
    setError(null)
    try {
      const res = await fetch(`/api/director/workflows/${workflow.id}/${verb}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { workflow: WorkflowDto }
      onUpdated?.(json.workflow)
    } catch (e) {
      setError(e instanceof Error ? e.message : `${verb} failed`)
    } finally {
      setSubmitting(null)
    }
  }

  return (
    <div
      data-testid="execution-card"
      role="group"
      aria-label="Workflow execution"
      style={{
        border: '1px solid var(--color-border-default)',
        borderRadius: 6,
        background: 'var(--color-bg-surface)',
        overflow: 'hidden',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <Header
        title={workflow.title || 'Plan in progress'}
        status={workflow.status}
        heartbeatVisible={workflow.status === 'running'}
        heartbeatFresh={heartbeatFresh}
      />
      {workflow.status === 'paused' || workflow.status === 'cancelled' ? (
        <BannerRow status={workflow.status} message={workflow.error_message ?? null} />
      ) : null}

      <ol style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {visibleSteps.map((step) => (
          <StepRow key={step.order} step={step} />
        ))}
      </ol>

      {error ? (
        <div
          role="alert"
          style={{
            padding: '8px 14px',
            background: 'rgba(184,48,48,0.08)',
            borderTop: '1px solid rgba(184,48,48,0.25)',
            fontSize: 11,
            color: 'var(--color-text-primary)',
          }}
        >
          {error}
        </div>
      ) : null}

      <Footer
        currentStepNumber={currentStepNumber}
        totalCount={visibleSteps.length}
        status={workflow.status}
        onPause={() => callTransition('pause')}
        onResume={() => callTransition('resume')}
        onStop={() => callTransition('stop')}
        submitting={submitting}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────

function Header({
  title,
  status,
  heartbeatVisible,
  heartbeatFresh,
}: {
  title: string
  status: WorkflowDto['status']
  heartbeatVisible: boolean
  heartbeatFresh: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'var(--color-bg-base)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <h3
        style={{
          margin: 0,
          fontWeight: 600,
          fontSize: 12,
          color: 'var(--color-text-primary)',
        }}
      >
        {title}
      </h3>
      {heartbeatVisible ? (
        <Heartbeat fresh={heartbeatFresh} />
      ) : null}
      <span
        style={{
          marginLeft: 'auto',
          fontWeight: 300,
          fontSize: 10,
          color: 'var(--color-text-muted)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        {status}
      </span>
    </div>
  )
}

function Heartbeat({ fresh }: { fresh: boolean }) {
  return (
    <span
      data-testid="execution-card-heartbeat"
      data-heartbeat-fresh={fresh ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      aria-label={fresh ? 'Director heartbeat — connected' : 'Director heartbeat — stalled'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <span
        className={fresh ? 'sv-heartbeat-fresh' : ''}
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: fresh
            ? 'var(--color-agent-running, #2e5a90)'
            : 'var(--color-text-muted)',
        }}
      />
      <span
        style={{
          fontWeight: 300,
          fontSize: 10,
          color: 'var(--color-text-muted)',
        }}
      >
        {fresh ? 'live' : 'stalled'}
      </span>
      <style>{`
        @keyframes sv-heartbeat-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%      { opacity: 0.6; transform: scale(0.85); }
        }
        .sv-heartbeat-fresh {
          animation: sv-heartbeat-pulse 1.5s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .sv-heartbeat-fresh { animation: none; }
        }
      `}</style>
    </span>
  )
}

function BannerRow({
  status,
  message,
}: {
  status: 'paused' | 'cancelled'
  message: string | null
}) {
  return (
    <div
      role="status"
      style={{
        padding: '6px 14px',
        background:
          status === 'paused'
            ? 'rgba(184,112,48,0.08)'
            : 'rgba(80,80,80,0.08)',
        borderBottom: '1px solid var(--color-border-subtle)',
        fontWeight: 300,
        fontSize: 11,
        color:
          status === 'paused'
            ? 'var(--color-status-review, #b87030)'
            : 'var(--color-text-secondary)',
      }}
    >
      {status === 'paused' ? '⏸ Paused' : '⏹ Cancelled'}
      {message ? ` — ${message}` : ''}
    </div>
  )
}

function StepRow({ step }: { step: WorkflowStepDto }) {
  const { icon, ariaLabel } = statusGlyph(step.status)
  const running = step.status === 'running'
  const failed = step.status === 'failed'
  const completed = step.status === 'completed'
  const skipped = step.status === 'skipped'

  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '8px 14px',
        minHeight: 44,
        borderBottom: '1px solid var(--color-border-subtle)',
        background: running ? 'rgba(46,90,144,0.05)' : 'transparent',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span
          aria-label={ariaLabel}
          className={running ? 'sv-step-running' : ''}
          style={{
            width: 14,
            display: 'inline-flex',
            justifyContent: 'center',
            marginTop: 1,
            color: failed
              ? 'var(--color-error, #b83030)'
              : completed
              ? 'var(--color-text-muted)'
              : 'var(--color-text-disabled)',
            fontSize: 12,
            lineHeight: 1.2,
          }}
        >
          {icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontWeight: running ? 500 : 400,
              fontSize: 11,
              color: completed || skipped
                ? 'var(--color-text-muted)'
                : failed
                ? 'var(--color-text-primary)'
                : running
                ? 'var(--color-text-primary)'
                : 'var(--color-text-disabled)',
              lineHeight: 1.4,
            }}
          >
            {operationLabel(step.operation_type)} ·{' '}
            <span style={{ fontWeight: 400 }}>{step.target_node_label}</span>
          </div>
          <div
            style={{
              fontWeight: 300,
              fontSize: 11,
              color: 'var(--color-text-muted)',
              lineHeight: 1.5,
              marginTop: 2,
            }}
          >
            {step.description}
          </div>
          {step.result_summary ? (
            <div
              style={{
                marginTop: 4,
                fontWeight: 300,
                fontSize: 10,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {step.result_summary}
            </div>
          ) : null}
          {step.error_message ? (
            <div
              role="alert"
              style={{
                marginTop: 4,
                fontWeight: 300,
                fontSize: 10,
                color: 'var(--color-error, #b83030)',
              }}
            >
              {step.error_message}
            </div>
          ) : null}
        </div>
      </div>
      <style>{`
        @keyframes sv-step-running-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.5; }
        }
        .sv-step-running { animation: sv-step-running-pulse 2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sv-step-running { animation: none; }
        }
      `}</style>
    </li>
  )
}

function Footer({
  currentStepNumber,
  totalCount,
  status,
  onPause,
  onResume,
  onStop,
  submitting,
}: {
  currentStepNumber: number
  totalCount: number
  status: WorkflowDto['status']
  onPause: () => void
  onResume: () => void
  onStop: () => void
  submitting: 'pause' | 'resume' | 'stop' | null
}) {
  const showPause = status === 'running'
  const showResume = status === 'paused'
  const showStop = status === 'running' || status === 'paused'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--color-bg-base)',
        borderTop: '1px solid var(--color-border-subtle)',
      }}
    >
      <span
        style={{
          fontWeight: 300,
          fontSize: 11,
          color: 'var(--color-text-muted)',
        }}
      >
        Step {currentStepNumber} of {totalCount}
      </span>
      <div style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
        {showPause ? (
          <button
            type="button"
            onClick={onPause}
            disabled={submitting !== null}
            style={ghostButtonStyle(submitting === 'pause')}
          >
            {submitting === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
        ) : null}
        {showResume ? (
          <button
            type="button"
            onClick={onResume}
            disabled={submitting !== null}
            style={ghostButtonStyle(submitting === 'resume')}
          >
            {submitting === 'resume' ? 'Resuming…' : 'Resume'}
          </button>
        ) : null}
        {showStop ? (
          <button
            type="button"
            onClick={onStop}
            disabled={submitting !== null}
            style={{
              ...ghostButtonStyle(submitting === 'stop'),
              color: 'var(--color-error, #b83030)',
              borderColor: 'var(--color-error, #b83030)',
            }}
          >
            {submitting === 'stop' ? 'Stopping…' : 'Stop'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function ghostButtonStyle(busy: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    color: 'var(--color-text-secondary)',
    border: '1px solid var(--color-border-subtle)',
    borderRadius: 4,
    padding: '4px 10px',
    fontWeight: 400,
    fontSize: 10,
    cursor: busy ? 'not-allowed' : 'pointer',
    fontFamily: 'var(--font-inter), Inter, sans-serif',
  }
}
