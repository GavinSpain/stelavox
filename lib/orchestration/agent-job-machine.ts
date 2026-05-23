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
import { casLookupSources } from './cas-lookup'

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

  // M-205 (Apollo iteration-fork fix) layer-0 foundation: TRUE CAS.
  //
  // The DB trigger `enforce_legal_transition` only raises when
  // OLD.state IS DISTINCT FROM NEW.state. Setting state=X on a row
  // already at X is treated as a no-op UPDATE — the trigger skips
  // the legality check entirely and the UPDATE silently succeeds.
  //
  // Fix: look up expected source state(s) from allowed_transitions
  // and add `.in('state', sources)` to the UPDATE. The loser's UPDATE
  // matches 0 rows and returns ok=false with error='cas_lost'.
  //
  // Surfaced 2026-05-23 by Simulator Scenario 11. Applied uniformly
  // across all entity machines via the shared casLookupSources helper.
  const lookup = await casLookupSources(supabase, 'agent_jobs', event, target)
  if (lookup.error) {
    return {
      ok: false,
      priorState: null,
      newState: null,
      error: lookup.error,
      message: lookup.message,
    }
  }

  const { data, error } = await supabase
    .from('agent_jobs')
    .update(updateFields)
    .eq('id', jobId)
    .in('state', lookup.expectedSources) // CAS guard
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
    // No row matched — either the row doesn't exist, OR (more likely
    // in race conditions) the row is no longer in the expected source
    // state because another writer beat us to the transition.
    //
    // We could query to disambiguate "not found" from "cas lost" but
    // that's another round-trip and callers handling either case the
    // same way. Return a single 'cas_lost' error code — it covers
    // both "row not found" and "row not in expected source state".
    return {
      ok: false,
      priorState: null,
      newState: null,
      error: 'cas_lost',
    }
  }

  return {
    ok: true,
    priorState: null, // we don't read prior — the CAS guard validated it
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

// ---------------------------------------------------------------------------
// State-aware cancel — M-205 follow-on for the CAS tightening
// ---------------------------------------------------------------------------

/**
 * Map each non-terminal agent_job state to its specific cancel event.
 * Used by markAgentJobCancelledAnyState to pick the right event for the
 * row's current state. Terminal states are no-ops (idempotent success).
 */
const CANCEL_EVENT_BY_STATE: Partial<Record<AgentJobState, AgentJobEvent>> = {
  queued:          'cancel_or_cascade',
  dispatched:      'cancel_mid_dispatch',
  running:         'cancel_mid_run',
  awaiting_accept: 'cancel',
}

/**
 * Cancel an agent_job regardless of its current active state.
 *
 * Pre-M-205, callers could pass any one cancel event (e.g. always
 * 'cancel_or_cascade') and the trigger would silently allow it because
 * the trigger only checks the (from, to) pair, not the event name. M-205
 * tightened transitionAgentJob to a true CAS keyed on the event, which
 * surfaced that those callers were event-misusing rows whose state had
 * already moved past the expected source.
 *
 * This helper reads the row's current state and dispatches to the
 * correct specific event. Idempotent on terminal states: if the row is
 * already accepted / dismissed / failed / crashed / cancelled, returns
 * ok=true with priorState set to the terminal state (so the caller can
 * surface "already done" cleanly).
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.6 (M-205
 * follow-on). The orchestration library exposes this as a single
 * primitive so cancel routes don't each duplicate the state→event map.
 */
export async function markAgentJobCancelledAnyState(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<TransitionResult<AgentJobState>> {
  const { data: row, error } = await supabase
    .from('agent_jobs')
    .select('state')
    .eq('id', jobId)
    .maybeSingle()
  if (error) {
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!row) {
    return { ok: false, priorState: null, newState: null, error: 'not_found' }
  }
  const currentState = row.state as AgentJobState

  // Terminal — idempotent success.
  const TERMINAL: AgentJobState[] = ['accepted', 'dismissed', 'failed', 'crashed', 'cancelled']
  if (TERMINAL.includes(currentState)) {
    return { ok: true, priorState: currentState, newState: currentState }
  }

  const event = CANCEL_EVENT_BY_STATE[currentState]
  if (!event) {
    // Unknown active state — should never happen, but fail closed.
    return {
      ok: false,
      priorState: currentState,
      newState: null,
      error: 'no_transition_for_event',
      message: `markAgentJobCancelledAnyState: no cancel event mapped for state '${currentState}'`,
    }
  }

  return transitionAgentJob(supabase, jobId, event, 'cancelled', {
    errorMessage: reason,
  })
}
