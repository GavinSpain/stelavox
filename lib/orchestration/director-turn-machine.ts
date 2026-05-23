/**
 * DirectorTurn state machine — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.6.
 *
 * M-205 follow-on (2026-05-23): replaced the hardcoded
 * `.eq('state', 'in_progress')` lock with the shared casLookupSources
 * helper. The hardcoded lock happened to be correct (director_turns
 * only ever transitions from 'in_progress'), but the pattern is
 * brittle — any new from_state added later would silently no-op.
 * Looking up the legal source(s) from allowed_transitions makes the
 * guard data-driven and consistent with every other machine.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DirectorTurnState } from './states'
import type { DirectorTurnEvent } from './events'
import type { TransitionResult } from './transition-result'
import { casLookupSources } from './cas-lookup'

export async function transitionDirectorTurn(
  supabase: SupabaseClient,
  turnId: string,
  event: DirectorTurnEvent,
  target: DirectorTurnState,
): Promise<TransitionResult<DirectorTurnState>> {
  const updateFields: Record<string, unknown> = { state: target }
  if (target === 'completed' || target === 'failed' || target === 'cancelled') {
    updateFields.completed_at = new Date().toISOString()
  }

  // M-205 CAS guard.
  const lookup = await casLookupSources(supabase, 'director_turns', event, target)
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
    .from('director_turns')
    .update(updateFields)
    .eq('id', turnId)
    .in('state', lookup.expectedSources)
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) {
    return { ok: false, priorState: null, newState: null, error: 'cas_lost' }
  }
  return { ok: true, priorState: null, newState: data.state as DirectorTurnState }
}
