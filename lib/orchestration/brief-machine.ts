/**
 * Brief state machine — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.1.
 *
 * Briefs have only 3 states and 2 transitions. The bulk of brief
 * lifecycle logic lives in the SQL RPCs (accept_brief, cancel_brief,
 * propagate_brief_completion). This module is a thin TS wrapper.
 *
 * M-205 follow-on (2026-05-23): now uses casLookupSources to enforce
 * TRUE CAS on the UPDATE, closing the same gap that affected
 * transitionAgentJob. The DB trigger only raises on
 * OLD.state IS DISTINCT FROM NEW.state — same-state writes used to
 * silently succeed. Now the UPDATE filters `.in('state', expectedSources)`
 * and loser races match 0 rows.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefState } from './states'
import type { BriefEvent } from './events'
import type { TransitionResult } from './transition-result'
import { casLookupSources } from './cas-lookup'

export async function transitionBrief(
  supabase: SupabaseClient,
  briefId: string,
  event: BriefEvent,
  target: BriefState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<BriefState>> {
  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'completed') updateFields.completed_at = new Date().toISOString()
  if (target === 'cancelled') updateFields.cancelled_at = new Date().toISOString()

  // M-205 CAS guard: look up legal source(s) and filter the UPDATE.
  const lookup = await casLookupSources(supabase, 'briefs', event, target)
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
    .from('briefs')
    .update(updateFields)
    .eq('id', briefId)
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
    // Row didn't exist OR state was not in expectedSources (CAS lost).
    return { ok: false, priorState: null, newState: null, error: 'cas_lost' }
  }
  return { ok: true, priorState: null, newState: data.state as BriefState }
}
