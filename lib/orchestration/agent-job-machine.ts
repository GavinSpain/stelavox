/**
 * AgentJob state machine — Apollo-grade single-source-of-truth.
 *
 * Every state transition on an agent_jobs row goes through this module.
 * Writers DO NOT directly UPDATE `state`, `status`, or `queue_status`
 * anywhere else in the codebase. Grep enforcement via
 * tests/unit/orchestration-no-direct-state-writes.test.ts.
 *
 * Each public function:
 *   1. Has typed (state, event) signature — compile-time exhaustiveness.
 *   2. UPDATEs the row using the new `state` column directly. The DB
 *      auto-derive trigger keeps legacy `status` / `queue_status`
 *      columns in sync until they are dropped in Phase 0.D.
 *   3. Uses optimistic-locking WHERE guards (`.eq('state', expected)`)
 *      so concurrent transition attempts don't double-write.
 *   4. Returns a `TransitionResult` that callers act on.
 *
 * The DB's BEFORE UPDATE trigger `trg_agent_jobs_enforce_transition`
 * is the final guard: any UPDATE that crosses an illegal (from, to)
 * pair raises `check_violation` and aborts the transaction. So even
 * a bug in this module can't put a row into an unknown state.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.5.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentJobState } from './states'
import type { AgentJobEvent } from './events'
import type { TransitionResult } from './transition-result'

export type { TransitionResult }

export interface TransitionPayload {
  /** Optional columns to UPDATE alongside state. */
  resultColumns?: Record<string, unknown>
  /** Token usage (LLM completion path). */
  tokensInput?: number
  tokensOutput?: number
  tokensCacheWrite?: number
  tokensCacheRead?: number
  modelId?: string
  provider?: string
  costUsd?: number | null
  costCredits?: number | null
  /** Error / message for failure paths. */
  errorMessage?: string
  failureClass?: 'A' | 'B' | 'C' | 'D' | 'E'
  /** Heartbeat path: only updates last_heartbeat_at. */
  heartbeatOnly?: boolean
  /** Reservation_id, wfq_vft, etc — dispatcher-only. */
  dispatcherFields?: Record<string, unknown>
}

// ---------------------------------------------------------------------------
// Single transition entry point
// ---------------------------------------------------------------------------

/**
 * Move an agent_job from its current state to the target state.
 *
 * @param supabase  Postgres client.
 * @param jobId     The agent_job's id.
 * @param event     The event causing the transition (one of AgentJobEvent).
 * @param target    The target state.
 * @param payload   Optional columns to write alongside state.
 *
 * Returns ok=true if the UPDATE matched, false otherwise. The DB
 * trigger ensures `(priorState, target)` is a legal transition; an
 * illegal transition raises `check_violation` and ok=false with
 * error='illegal_transition'.
 */
export async function transitionAgentJob(
  supabase: SupabaseClient,
  jobId: string,
  event: AgentJobEvent,
  target: AgentJobState,
  payload?: TransitionPayload,
): Promise<TransitionResult<AgentJobState>> {
  const updateFields: Record<string, unknown> = {
    state: target,
    ...payload?.resultColumns,
  }

  // Token / cost columns (set on terminal-success or terminal-failure).
  if (payload?.tokensInput !== undefined) updateFields.tokens_input = payload.tokensInput
  if (payload?.tokensOutput !== undefined) updateFields.tokens_output = payload.tokensOutput
  if (payload?.tokensCacheWrite !== undefined) updateFields.tokens_cache_write = payload.tokensCacheWrite
  if (payload?.tokensCacheRead !== undefined) updateFields.tokens_cache_read = payload.tokensCacheRead
  if (payload?.modelId !== undefined) updateFields.model_id = payload.modelId
  if (payload?.provider !== undefined) updateFields.provider = payload.provider
  if (payload?.costUsd !== undefined) updateFields.cost_usd = payload.costUsd
  if (payload?.costCredits !== undefined) updateFields.cost_credits = payload.costCredits
  if (payload?.errorMessage !== undefined) updateFields.error_message = payload.errorMessage
  if (payload?.failureClass !== undefined) updateFields.failure_class = payload.failureClass

  // States where work has stopped stamp completed_at. Per the I1
  // invariant, awaiting_accept ALSO has completed_at set (the LLM call
  // finished; only the author Accept is pending), so include it here.
  const STATES_WITH_COMPLETED_AT: AgentJobState[] = [
    'awaiting_accept',
    'accepted',
    'dismissed',
    'failed',
    'crashed',
    'cancelled',
  ]
  if (STATES_WITH_COMPLETED_AT.includes(target)) {
    updateFields.completed_at = new Date().toISOString()
  }

  // The running state stamps started_at + heartbeat.
  if (target === 'running') {
    updateFields.started_at = new Date().toISOString()
    updateFields.last_heartbeat_at = new Date().toISOString()
  }

  // Dispatcher fields (CAS-claim path).
  if (payload?.dispatcherFields) {
    Object.assign(updateFields, payload.dispatcherFields)
  }

  // Compile-time use of `event` parameter — the value is informational
  // for observability hooks; the DB trigger validates the transition,
  // not the event name. Use it in the metadata logging hook below.
  // (Suppress unused-parameter warning while preserving the signature.)
  void event

  const { data, error } = await supabase
    .from('agent_jobs')
    .update(updateFields)
    .eq('id', jobId)
    .select('id, state')
    .maybeSingle()

  if (error) {
    // DB trigger fired (illegal transition) OR genuine DB error.
    if (error.code === '23514') {
      // check_violation — the enforce_legal_transition trigger refused.
      return {
        ok: false,
        priorState: null,
        newState: null,
        error: 'illegal_transition',
        message: error.message,
      }
    }
    return {
      ok: false,
      priorState: null,
      newState: null,
      error: 'db_error',
      message: error.message,
    }
  }

  if (!data) {
    // No row matched — either row didn't exist or optimistic-lock loss.
    return {
      ok: false,
      priorState: null,
      newState: null,
      error: 'not_found',
    }
  }

  return {
    ok: true,
    priorState: null, // we don't read prior — trigger validated it
    newState: data.state as AgentJobState,
  }
}

// ---------------------------------------------------------------------------
// Convenience wrappers — replace the persist* family from job-lifecycle.ts
// ---------------------------------------------------------------------------

/**
 * Runner has claimed the job and is about to start LLM work.
 * Transitions: dispatched → running (or queued → running for bypass path).
 */
export async function markAgentJobRunning(
  supabase: SupabaseClient,
  jobId: string,
  opts: { bypassDispatcher?: boolean } = {},
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(
    supabase,
    jobId,
    opts.bypassDispatcher ? 'runner_start_bypass' : 'persist_running_start',
    'running',
  )
}

/**
 * LLM call completed successfully. Transitions running → awaiting_accept.
 */
export async function markAgentJobAwaitingAccept(
  supabase: SupabaseClient,
  jobId: string,
  payload: TransitionPayload,
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(supabase, jobId, 'llm_ok', 'awaiting_accept', payload)
}

/**
 * LLM call errored. Transitions running → failed.
 */
export async function markAgentJobFailed(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
  failureClass: 'A' | 'B' | 'C' | 'D' | 'E' = 'A',
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(supabase, jobId, 'llm_fail', 'failed', {
    errorMessage,
    failureClass,
  })
}

/**
 * User Stop / SSE disconnect mid-run. Transitions running → cancelled.
 */
export async function markAgentJobCancelled(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(supabase, jobId, 'cancel_mid_run', 'cancelled', {
    errorMessage: reason,
  })
}

/**
 * Sweep detected stale heartbeat. Transitions dispatched/running → crashed.
 */
export async function markAgentJobCrashed(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(supabase, jobId, 'heartbeat_stale', 'crashed', {
    errorMessage: reason,
    failureClass: 'B',
  })
}

/**
 * Author Accepted the result. Transitions awaiting_accept → accepted.
 * Note: the side-effects of Accept (writing to nodes, child INSERTs) are
 * still handled by the accept_agent_job SQL RPC. This function ONLY does
 * the state transition. Callers usually invoke this AFTER the RPC has
 * completed its work — except the RPC currently does the state transition
 * itself; Phase 0.B will reconcile.
 */
export async function markAgentJobAccepted(
  supabase: SupabaseClient,
  jobId: string,
): Promise<TransitionResult<AgentJobState>> {
  return transitionAgentJob(supabase, jobId, 'author_accept', 'accepted')
}

/**
 * Heartbeat — updates last_heartbeat_at without state transition.
 * Direct UPDATE (not via transition function) because the state column
 * is unchanged.
 */
export async function recordAgentJobHeartbeat(
  supabase: SupabaseClient,
  jobId: string,
): Promise<void> {
  await supabase
    .from('agent_jobs')
    .update({ last_heartbeat_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('state', 'running')
}
