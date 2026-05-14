import 'server-only'

/**
 * V1.x-B.1.1 session 3b — director_iterations store.
 *
 * Source: V1.x-B.1.1 build checklist §3.3 T-3.2 + M-093 + Director Architecture v2.0 §8.1a.
 *
 * Load + save iteration state against the director_iterations table.
 * Substrate for the per-iteration executor refactor (session 3c). The
 * existing single-function executor doesn't yet consume this — but
 * landing the store in 3b lets 3c be a focused refactor without a
 * "build substrate first" overhead.
 *
 * Key invariants (per design record §6 idempotency contract):
 *   - Iterations are idempotent: re-running the same iteration_number
 *     against the same persisted state produces the same outcome (modulo
 *     LLM stochasticity, which the propose-only invariant means is safe).
 *   - State persists at iteration boundaries — never mid-iteration.
 *   - The (turn_id, iteration_number) UNIQUE constraint ensures we never
 *     double-create an iteration row.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import type { IterationState, IterationStatus, FailureClass } from './types'

export interface IterationRow {
  id: string
  turn_id: string
  iteration_number: number
  status: IterationStatus
  started_at: string | null
  completed_at: string | null
  last_heartbeat_at: string | null
  failure_class: FailureClass | null
  failure_message: string | null
  messages_snapshot: unknown[]
  accumulated_proposals: unknown[]
  tokens_in: number | null
  tokens_out: number | null
  cost_credits: number | null
  created_at: string
}

/**
 * Insert a fresh iteration row in `pending` status. Returns the row id.
 * Caller (executor) transitions to `running` via beginIteration() right
 * before invoking the Anthropic call.
 *
 * Idempotent under retry: if a row with (turn_id, iteration_number)
 * already exists, returns the existing id without modification.
 */
export async function createIteration(
  turnId: string,
  iterationNumber: number,
  initialState: { messages_snapshot?: unknown[]; accumulated_proposals?: unknown[] } = {},
): Promise<string> {
  const supabase = createServiceRoleClient()

  // Try insert; on conflict, return the existing row's id.
  const { data: inserted, error: insertErr } = await supabase
    .from('director_iterations')
    .insert({
      turn_id: turnId,
      iteration_number: iterationNumber,
      status: 'pending',
      messages_snapshot: initialState.messages_snapshot ?? [],
      accumulated_proposals: initialState.accumulated_proposals ?? [],
    })
    .select('id')
    .single()

  if (inserted) return inserted.id

  // Conflict path — fetch the existing row.
  if (insertErr && insertErr.code === '23505') {
    const { data: existing } = await supabase
      .from('director_iterations')
      .select('id')
      .eq('turn_id', turnId)
      .eq('iteration_number', iterationNumber)
      .single()
    if (existing) return existing.id
  }

  throw new Error(`createIteration failed: ${insertErr?.message ?? 'no row returned'}`)
}

/**
 * Load the most recent state needed to begin or resume an iteration.
 * Returns null if no row exists for (turn_id, iteration_number).
 */
export async function loadIterationState(
  turnId: string,
  iterationNumber: number,
): Promise<IterationState | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('director_iterations')
    .select('messages_snapshot, accumulated_proposals')
    .eq('turn_id', turnId)
    .eq('iteration_number', iterationNumber)
    .maybeSingle()

  if (!data) return null
  return {
    turn_id: turnId,
    iteration_number: iterationNumber,
    messages_snapshot: (data.messages_snapshot as unknown[]) ?? [],
    accumulated_proposals: (data.accumulated_proposals as unknown[]) ?? [],
  }
}

/**
 * Mark an iteration as `running` and stamp started_at + last_heartbeat_at.
 * Called by the executor right before invoking the Anthropic call.
 */
export async function beginIteration(turnId: string, iterationNumber: number): Promise<void> {
  const supabase = createServiceRoleClient()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('director_iterations')
    .update({ status: 'running', started_at: now, last_heartbeat_at: now })
    .eq('turn_id', turnId)
    .eq('iteration_number', iterationNumber)
    .in('status', ['pending', 'interrupted'])  // allow resume from interrupted
  if (error) throw new Error(`beginIteration failed: ${error.message}`)
}

/**
 * Save terminal state at iteration end. Updates status + completed_at +
 * accumulated state + cost. The `messages_snapshot` here is the input
 * snapshot to the NEXT iteration (or the final state if no more
 * iterations).
 */
export interface SaveIterationStateInput {
  status: Exclude<IterationStatus, 'pending' | 'running'>
  next_messages_snapshot?: unknown[]
  next_accumulated_proposals?: unknown[]
  failure_class?: FailureClass
  failure_message?: string
  tokens_in?: number
  tokens_out?: number
  cost_credits?: number
}

export async function saveIterationState(
  turnId: string,
  iterationNumber: number,
  input: SaveIterationStateInput,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const update: Record<string, unknown> = {
    status: input.status,
    completed_at: new Date().toISOString(),
  }
  if (input.next_messages_snapshot !== undefined) {
    update.messages_snapshot = input.next_messages_snapshot
  }
  if (input.next_accumulated_proposals !== undefined) {
    update.accumulated_proposals = input.next_accumulated_proposals
  }
  if (input.failure_class !== undefined) update.failure_class = input.failure_class
  if (input.failure_message !== undefined) update.failure_message = input.failure_message
  if (input.tokens_in !== undefined) update.tokens_in = input.tokens_in
  if (input.tokens_out !== undefined) update.tokens_out = input.tokens_out
  if (input.cost_credits !== undefined) update.cost_credits = input.cost_credits

  const { error } = await supabase
    .from('director_iterations')
    .update(update)
    .eq('turn_id', turnId)
    .eq('iteration_number', iterationNumber)
  if (error) throw new Error(`saveIterationState failed: ${error.message}`)
}

/**
 * Find the highest-numbered iteration for a turn that's reached a
 * terminal `completed` status. Returns null if no iteration has
 * completed (turn is fresh or all iterations are pending/running/failed).
 *
 * Used by the dispatcher to decide whether to start iteration 1 or
 * resume from N+1.
 */
export async function getLastCompletedIteration(turnId: string): Promise<IterationRow | null> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('director_iterations')
    .select(
      'id, turn_id, iteration_number, status, started_at, completed_at, last_heartbeat_at, failure_class, failure_message, messages_snapshot, accumulated_proposals, tokens_in, tokens_out, cost_credits, created_at',
    )
    .eq('turn_id', turnId)
    .eq('status', 'completed')
    .order('iteration_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  return data as unknown as IterationRow
}
