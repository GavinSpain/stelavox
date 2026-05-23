/**
 * Workflow + WorkflowStep state machines — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.3 / §11.4.
 *
 * M-205 follow-on (2026-05-23): both transition functions now use
 * casLookupSources to enforce TRUE CAS on the UPDATE. workflows has
 * the multi-source event 'cancel' (from 4 different states); the
 * helper handles that via .in('state', sources).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowState, WorkflowStepState } from './states'
import type { WorkflowEvent, WorkflowStepEvent } from './events'
import type { TransitionResult } from './transition-result'
import { casLookupSources } from './cas-lookup'

export async function transitionWorkflow(
  supabase: SupabaseClient,
  workflowId: string,
  event: WorkflowEvent,
  target: WorkflowState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<WorkflowState>> {
  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'approved') updateFields.approved_at = new Date().toISOString()
  if (target === 'completed') updateFields.completed_at = new Date().toISOString()
  if (target === 'cancelled') updateFields.cancelled_at = new Date().toISOString()

  // M-205 CAS guard.
  const lookup = await casLookupSources(supabase, 'workflows', event, target)
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
    .from('workflows')
    .update(updateFields)
    .eq('id', workflowId)
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
  return { ok: true, priorState: null, newState: data.state as WorkflowState }
}

export async function transitionWorkflowStep(
  supabase: SupabaseClient,
  stepId: string,
  event: WorkflowStepEvent,
  target: WorkflowStepState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<WorkflowStepState>> {
  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'running') updateFields.started_at = new Date().toISOString()
  if (target === 'completed' || target === 'failed' || target === 'skipped') {
    updateFields.completed_at = new Date().toISOString()
  }

  // M-205 CAS guard.
  const lookup = await casLookupSources(supabase, 'workflow_steps', event, target)
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
    .from('workflow_steps')
    .update(updateFields)
    .eq('id', stepId)
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
  return { ok: true, priorState: null, newState: data.state as WorkflowStepState }
}
