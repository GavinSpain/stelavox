/**
 * Brief state machine — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.1.
 *
 * Briefs have only 3 states and 2 transitions. The bulk of brief
 * lifecycle logic lives in the SQL RPCs (accept_brief, cancel_brief,
 * propagate_brief_completion). This module is a thin TS wrapper.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefState } from './states'
import type { BriefEvent } from './events'
import type { TransitionResult } from './transition-result'

export async function transitionBrief(
  supabase: SupabaseClient,
  briefId: string,
  event: BriefEvent,
  target: BriefState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<BriefState>> {
  void event

  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'completed') updateFields.completed_at = new Date().toISOString()
  if (target === 'cancelled') updateFields.cancelled_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('briefs')
    .update(updateFields)
    .eq('id', briefId)
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, priorState: null, newState: null, error: 'not_found' }
  return { ok: true, priorState: null, newState: data.state as BriefState }
}
