/**
 * V1.x-D.2 — NodeLifecycleBadge.
 *
 * Source: Component Spec §17.8 · wireframe_node_row_v2_badges_v1.html §02 / §03.
 *
 * Pill-text badge rendered in NodeRow when the node has an active or
 * recently-completed agent_job. Distinct from the existing 8×8
 * NodeStatusBadge dot (author-set status: draft / in_review / approved /
 * locked). Lifecycle states represent the AGENT's view of the node;
 * status represents the AUTHOR's view. Both can render simultaneously.
 *
 * Mapping from agent_jobs.status to lifecycle label:
 *   - pending → QUEUED  (V1.x-D MVP collapses scheduled + queued — the
 *                        scheduler-internal distinction isn't author-
 *                        relevant; both look like "waiting")
 *   - running → RUN
 *   - completed → NEW   (author hasn't called accept_agent_job yet)
 *   - accepted | dismissed | cancelled | failed → no badge
 *     (failed has its own surface via AgentTab; the others are terminal)
 *
 * Inviolable #2: no verdigris. Tokens used:
 *   - --color-text-secondary for QUEUED / RUN background tint
 *   - --color-agent-running for RUN text colour (existing convention)
 *   - --color-status-review (attention-amber) for NEW (consistent with
 *     the in-review status convention — author action needed)
 */

type LifecycleState = 'queued' | 'running' | 'completed-pending-review' | null

const LIFECYCLE_LABEL: Record<Exclude<LifecycleState, null>, string> = {
  queued: 'QUEUED',
  running: 'RUN',
  'completed-pending-review': 'NEW',
}

const LIFECYCLE_BG: Record<Exclude<LifecycleState, null>, string> = {
  queued: 'rgba(74,96,128,0.20)',  // --color-status-draft tint
  running: 'rgba(46,90,144,0.20)', // --color-agent-running tint
  'completed-pending-review': 'rgba(184,112,48,0.16)', // --color-status-review tint
}

const LIFECYCLE_FG: Record<Exclude<LifecycleState, null>, string> = {
  queued: 'var(--color-text-secondary)',
  running: 'var(--color-agent-running)',
  'completed-pending-review': 'var(--color-status-review)',
}

export function lifecycleFromJobStatus(jobStatus: string | undefined): LifecycleState {
  switch (jobStatus) {
    case 'pending':
      return 'queued'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed-pending-review'
    default:
      return null
  }
}

export function NodeLifecycleBadge({ state }: { state: LifecycleState }) {
  if (state === null) return null
  return (
    <span
      data-testid="node-lifecycle-badge"
      data-lifecycle={state}
      style={{
        fontSize: 9,
        fontWeight: 500,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '1px 5px',
        borderRadius: 2,
        background: LIFECYCLE_BG[state],
        color: LIFECYCLE_FG[state],
        flexShrink: 0,
      }}
    >
      {LIFECYCLE_LABEL[state]}
    </span>
  )
}

export type { LifecycleState }
