/**
 * BriefStage state machine — Apollo-grade.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.2.
 *
 * Includes the new `'ready'` state (Q2) that distinguishes
 * workflow-attached-awaiting-completion from no-workflow-yet.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefStageState } from './states'
import type { BriefStageEvent } from './events'
import type { TransitionResult } from './transition-result'

export async function transitionBriefStage(
  supabase: SupabaseClient,
  stageId: string,
  event: BriefStageEvent,
  target: BriefStageState,
  extra?: Record<string, unknown>,
): Promise<TransitionResult<BriefStageState>> {
  void event

  const updateFields: Record<string, unknown> = { state: target, ...extra }
  if (target === 'completed' || target === 'cancelled' || target === 'failed') {
    updateFields.completed_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('brief_stages')
    .update(updateFields)
    .eq('id', stageId)
    .select('id, state')
    .maybeSingle()

  if (error) {
    if (error.code === '23514') {
      return { ok: false, priorState: null, newState: null, error: 'illegal_transition', message: error.message }
    }
    return { ok: false, priorState: null, newState: null, error: 'db_error', message: error.message }
  }
  if (!data) return { ok: false, priorState: null, newState: null, error: 'not_found' }
  return { ok: true, priorState: null, newState: data.state as BriefStageState }
}

/**
 * Attach a workflow to a stage. Used by both:
 *   * brief approve route (stage 1 workflow-bound) — fromState='planned'
 *   * iteration-runner propose_workflow path — fromState='planning'
 *
 * Updates BOTH workflow_id and state in one UPDATE.
 */
export async function attachWorkflowToBriefStage(
  supabase: SupabaseClient,
  stageId: string,
  workflowId: string,
  fromState: 'planned' | 'planning',
): Promise<TransitionResult<BriefStageState>> {
  const event: BriefStageEvent = fromState === 'planning' ? 'attach_workflow_planned' : 'attach_workflow_initial'
  return transitionBriefStage(supabase, stageId, event, 'ready', {
    workflow_id: workflowId,
    // Per spec §11.2 G-20: clear prompt once workflow is attached
    // (the prompt was consumed; keeping it is a drift surface).
    prompt: null,
  })
}
