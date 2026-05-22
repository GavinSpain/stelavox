/**
 * Workflow + WorkflowStep state machines — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.3 / §11.4.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WorkflowState, WorkflowStepState } from './states'
import type { WorkflowEvent, WorkflowStepEvent } from './events'
import type { TransitionResult } from './transition-result'

export async function transitionWorkflow(
  supabase: SupabaseClient,
  workflowId: string,
  event: WorkflowEvent,
  target: WorkflowState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<WorkflowState>> {
  void event

  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'approved') updateFields.approved_at = new Date().toISOString()
  if (target === 'completed') updateFields.completed_at = new Date().toISOString()
  if (target === 'cancelled') updateFields.cancelled_at = new Date().toISOString()

  const { data, error } = await supabase
    .from('workflows')
    .update(updateFields)
    .eq('id', workflowId)
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, priorState: null, newState: null, error: 'not_found' }
  return { ok: true, priorState: null, newState: data.state as WorkflowState }
}

export async function transitionWorkflowStep(
  supabase: SupabaseClient,
  stepId: string,
  event: WorkflowStepEvent,
  target: WorkflowStepState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<WorkflowStepState>> {
  void event

  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'running') updateFields.started_at = new Date().toISOString()
  if (target === 'completed' || target === 'failed' || target === 'skipped') {
    updateFields.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('workflow_steps')
    .update(updateFields)
    .eq('id', stepId)
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, priorState: null, newState: null, error: 'not_found' }
  return { ok: true, priorState: null, newState: data.state as WorkflowStepState }
}
