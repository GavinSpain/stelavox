/**
 * Shared CAS-lookup helper for all entity state machines.
 *
 * Source: M-205 follow-on. docs/stelavox_brief_orchestration_v1_0.md §11.6
 *
 * The DB's enforce_legal_transition trigger only RAISES when
 * OLD.state IS DISTINCT FROM NEW.state — it cannot catch same-state
 * UPDATE writes (which silently succeed). For true CAS we look up the
 * expected source state(s) for (entity, event, target) from
 * allowed_transitions and filter the UPDATE with .in('state', sources).
 *
 * Loser races match 0 rows, the caller returns ok=false with
 * error='cas_lost', and any layer-1 guard (e.g. iteration-runner's
 * claim guard) can exit silently.
 *
 * This helper is the shared implementation. Each machine
 * (agent-job, brief, brief_stage, workflow, workflow_step,
 * director_turn) calls it before its UPDATE.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface CasLookupResult {
  /** Expected source states (one or many, per allowed_transitions). */
  expectedSources: string[]
  /** Error if the lookup itself failed or returned no rows. */
  error?: 'no_transition_for_event' | 'db_error'
  /** Diagnostic message on lookup error. */
  message?: string
}

/**
 * Look up the legal source state(s) for an (entity, event, target)
 * transition. Returns an array because some events legitimately have
 * multiple sources (e.g. workflows.cancel from 4 different states).
 *
 * @param supabase    Postgres client (RLS is OFF on allowed_transitions
 *                    so a user-bound client works).
 * @param entityName  agent_jobs / briefs / brief_stages / workflows /
 *                    workflow_steps / director_turns.
 * @param event       The event_name column.
 * @param target      The to_state column.
 */
export async function casLookupSources(
  supabase: SupabaseClient,
  entityName: string,
  event: string,
  target: string,
): Promise<CasLookupResult> {
  const { data, error } = await supabase
    .from('allowed_transitions')
    .select('from_state')
    .eq('entity_name', entityName)
    .eq('event_name', event)
    .eq('to_state', target)

  if (error) {
    return {
      expectedSources: [],
      error: 'db_error',
      message: `allowed_transitions lookup failed for (${entityName}, ${event}, ${target}): ${error.message}`,
    }
  }

  const sources = (data ?? []).map((r) => r.from_state as string)
  if (sources.length === 0) {
    return {
      expectedSources: [],
      error: 'no_transition_for_event',
      message: `no allowed_transitions row for (entity_name='${entityName}', event_name='${event}', to_state='${target}')`,
    }
  }

  return { expectedSources: sources }
}
