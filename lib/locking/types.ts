/**
 * Phase 6 — locking primitive types.
 *
 * Three lock categories per Phase 6 wireframe §01:
 *   1. Author Lock     — durable per-node author intent
 *   2. Edit Session    — coworker presence (5-min ephemeral)
 *   3. Agent In-Flight — job-lifetime, derived from agent_jobs
 *
 * `check_node_writable` RPC (M-150) returns one of these blockers
 * in priority order: author_locked → node_in_use → node_in_progress.
 */

export type LockBlocker =
  | 'author_locked'
  | 'node_in_use'
  | 'node_in_progress'
  | 'not_found'

export interface AuthorLockedDetails {
  reason: string | null
  locked_at: string
}

export interface NodeInUseDetails {
  held_by_user_id: string
  expires_at: string
}

export interface NodeInProgressDetails {
  job_id: string
  operation_type: string
  status: string
  queue_status: string
  started_at: string
}

export type WriteGateResult =
  | { writable: true; blocker: null; details: null }
  | { writable: false; blocker: 'author_locked'; details: AuthorLockedDetails }
  | { writable: false; blocker: 'node_in_use'; details: NodeInUseDetails }
  | { writable: false; blocker: 'node_in_progress'; details: NodeInProgressDetails }
  | { writable: false; blocker: 'not_found'; details: null }
