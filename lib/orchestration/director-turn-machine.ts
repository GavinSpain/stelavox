/**
 * DirectorTurn state machine — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.6.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DirectorTurnState } from './states'
import type { DirectorTurnEvent } from './events'
import type { TransitionResult } from './transition-result'

export async function transitionDirectorTurn(
  supabase: SupabaseClient,
  turnId: string,
  event: DirectorTurnEvent,
  target: DirectorTurnState,
): Promise<TransitionResult<DirectorTurnState>> {
  void event

  const updateFields: Record<string, unknown> = { state: target }
  if (target === 'completed' || target === 'failed' || target === 'cancelled') {
    updateFields.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('director_turns')
    .update(updateFields)
    .eq('id', turnId)
    .eq('state', 'in_progress') // optimistic-lock guard
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, priorState: null, newState: null, error: 'not_found' }
  return { ok: true, priorState: null, newState: data.state as DirectorTurnState }
}
