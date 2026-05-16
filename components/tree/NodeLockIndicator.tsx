/**
 * NodeLockIndicator — three categories of lock-like state on a node.
 *
 * Phase 6 wireframe §01 / Component Spec v2.16 §4.3a.
 *
 * Renders one of:
 *   1. Author Lock (Category 1) — 🔒 in --color-text-muted
 *      Persistent author-set lock. Tooltip on hover names the
 *      author and their reason.
 *
 *   2. Agent In-Flight — Category 3 — one of three sub-states:
 *      - QUEUED   ⧗ in --color-info, opacity 0.7
 *                   (queued OR dispatched in scheduler terms)
 *      - RUNNING  ⟳ in --color-agent-running, pulsing
 *      - REVIEW   ● in --color-status-review (filled dot)
 *                   (completed, awaiting author Accept/Dismiss —
 *                    indefinite by design per D6, also serves as
 *                    the review-needed backlog signal)
 *
 *   3. Otherwise — placeholder · (alignment-preserving spacer).
 *
 * The Edit Session category (#2) is a coworker-presence concept and
 * renders elsewhere (an avatar in the row, not a lock glyph).
 *
 * V1.x-D shipped this inline in NodeRow with the legacy `status` enum
 * predicate (pending|running|completed). Phase 6 extracts to its own
 * component and switches to the V1.x-B.2-aware `queue_status`
 * predicate (queued|dispatched|running) plus the legacy `completed`
 * for the review-pending state.
 *
 * NOT verdigris — Inviolable #2 audit per Phase 6 wireframe §Inviolable.
 */

import { useActiveJobForNode } from '@/lib/hooks/useAgentJobsRealtime'

type AgentSubState = 'queued' | 'running' | 'review' | null

function deriveAgentSubState(job: ReturnType<typeof useActiveJobForNode>): AgentSubState {
  if (!job) return null
  // queue_status was added in V1.x-B.2 (M-106). Older rows have
  // queue_status backfilled from status (pending→queued etc).
  const q = (job as { queue_status?: string }).queue_status
  if (q === 'queued' || q === 'dispatched') return 'queued'
  if (q === 'running') return 'running'
  // status='completed' is the indefinite review-pending state (D6).
  if (job.status === 'completed') return 'review'
  // Fallback: legacy rows where queue_status is absent. Use status.
  if (!q && (job.status === 'pending')) return 'queued'
  if (!q && (job.status === 'running')) return 'running'
  return null
}

export function NodeLockIndicator({
  nodeId,
  userLocked,
}: {
  nodeId: string
  userLocked: boolean
}) {
  const job = useActiveJobForNode(nodeId)
  const subState = deriveAgentSubState(job)

  // Author Lock takes precedence over Agent In-Flight in the visual.
  // The author lock is the more permanent state; agent in-flight is
  // transient. (Functionally a node shouldn't be both at the same
  // time anyway — lock proposal does a conflict check per D3.)
  if (userLocked) {
    return (
      <span
        aria-label="locked by you"
        data-testid="node-user-lock"
        style={{
          width: '14px',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: '11px',
          flexShrink: 0,
        }}
      >
        🔒
      </span>
    )
  }

  if (subState === 'queued') {
    return (
      <span
        aria-label="queued — agent will start when capacity is free"
        data-testid="node-agent-queued"
        style={{
          width: '14px',
          textAlign: 'center',
          color: 'var(--color-info)',
          fontSize: '11px',
          flexShrink: 0,
          opacity: 0.7,
        }}
      >
        ⧗
      </span>
    )
  }

  if (subState === 'running') {
    return (
      <span
        aria-label="AI is working on this"
        data-testid="node-agent-running"
        style={{
          width: '14px',
          textAlign: 'center',
          color: 'var(--color-agent-running)',
          fontSize: '11px',
          flexShrink: 0,
          animation: 'lock-running-pulse 2s ease-in-out infinite',
        }}
      >
        ⟳
        <style>{`
          @keyframes lock-running-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
          @media (prefers-reduced-motion: reduce) {
            [data-testid="node-agent-running"] { animation: none !important; }
          }
        `}</style>
      </span>
    )
  }

  if (subState === 'review') {
    return (
      <span
        aria-label="result ready for review"
        data-testid="node-agent-review"
        style={{
          width: '14px',
          textAlign: 'center',
          color: 'var(--color-status-review)',
          fontSize: '11px',
          flexShrink: 0,
        }}
      >
        ●
      </span>
    )
  }

  // No lock-like state — render alignment spacer.
  return (
    <span
      aria-hidden="true"
      style={{
        width: '14px',
        textAlign: 'center',
        color: 'var(--color-text-muted)',
        fontSize: '11px',
        flexShrink: 0,
      }}
    >
      ·
    </span>
  )
}
