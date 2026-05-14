import 'server-only'

/**
 * RPC wrappers for Brief lifecycle operations.
 *
 * V1.x-A.1:
 *   accept_brief — atomic Brief creation from user-approved proposal.
 *   complete_brief_stage — stage finished; advance Brief state (manual path).
 *
 * V1.x-B.1.1:
 *   cancel_brief — revised signature (UUID, TEXT) → CancelBriefResult;
 *     cascade-cancels stages, emits cancel_cascade system event,
 *     auto-promotes next queued Brief.
 *   complete_brief_stage_workflow — called when a workflow's last step
 *     accepts; transitions stage, advances Brief, may propagate.
 *   propagate_brief_completion — closes Brief if all stages terminal;
 *     emits brief_completed; auto-promotes next queued.
 *   promote_next_queued_brief — manual queue advancement (admin path).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BriefProposal,
  BriefRpcResult,
  CancelBriefResult,
} from './types'

export class BriefRpcError extends Error {
  constructor(message: string, public code: string | undefined, public rpc: string) {
    super(message)
    this.name = 'BriefRpcError'
  }
}

// ---------------------------------------------------------------------------
// V1.x-A.1 RPCs (preserved; revised behaviour for V1.x-B.1.1 queueing).
// ---------------------------------------------------------------------------

/**
 * accept_brief — atomic insert of briefs + brief_stages rows.
 *
 * V1.x-B.1.1: when an active Brief exists on the document, the new
 * Brief lands as 'queued' with sequence_position = MAX+1 instead of
 * being rejected. The RPC returns the resolved status + queue_position
 * in a wrapper jsonb.
 */
export async function acceptBrief(
  supabase: SupabaseClient,
  documentId: string,
  proposal: BriefProposal,
): Promise<BriefRpcResult & { initial_status?: string; queue_position?: number }> {
  const stagesForRpc = proposal.stages.map((s) => ({
    order: s.order,
    title: s.title,
    description: s.description,
    trigger_type: s.trigger_type,
    trigger_config: s.trigger_config,
  }))

  const { data, error } = await supabase.rpc('accept_brief', {
    p_document_id: documentId,
    p_goal_text: proposal.goal_text,
    p_stages: stagesForRpc,
  })
  if (error) throw new BriefRpcError(error.message, error.code, 'accept_brief')
  if (!data) throw new Error('accept_brief: empty result')
  return data as unknown as BriefRpcResult & { initial_status?: string; queue_position?: number }
}

export async function completeBriefStage(
  supabase: SupabaseClient,
  stageId: string,
): Promise<BriefRpcResult> {
  const { data, error } = await supabase.rpc('complete_brief_stage', { p_stage_id: stageId })
  if (error) throw new BriefRpcError(error.message, error.code, 'complete_brief_stage')
  return data as unknown as BriefRpcResult
}

// ---------------------------------------------------------------------------
// V1.x-B.1.1 RPCs.
// ---------------------------------------------------------------------------

/**
 * cancel_brief (V1.x-B.1.1 signature) — cascade-cancel + auto-promote.
 *
 * Returns CancelBriefResult with cascade summary. The reason is logged
 * in the cancel_cascade system event payload.
 */
export async function cancelBrief(
  supabase: SupabaseClient,
  briefId: string,
  reason: string = 'user_cancelled',
): Promise<CancelBriefResult> {
  const { data, error } = await supabase.rpc('cancel_brief', {
    p_brief_id: briefId,
    p_reason: reason,
  })
  if (error) throw new BriefRpcError(error.message, error.code, 'cancel_brief')
  return data as unknown as CancelBriefResult
}

export interface CompleteBriefStageWorkflowResult {
  workflow_id?: string
  no_linked_stage?: boolean
  stage_id?: string
  already_completed?: boolean
  closed?: boolean
  next_stage_id?: string | null
  brief_id?: string
  promoted_brief_id?: string | null
}

/**
 * complete_brief_stage_workflow — called when the last incomplete step
 * in a workflow accepts. Normally invoked automatically from inside
 * accept_agent_job (M-098). Direct call from lib is for recovery paths.
 */
export async function completeBriefStageWorkflow(
  supabase: SupabaseClient,
  workflowId: string,
): Promise<CompleteBriefStageWorkflowResult> {
  const { data, error } = await supabase.rpc('complete_brief_stage_workflow', {
    p_workflow_id: workflowId,
  })
  if (error) throw new BriefRpcError(error.message, error.code, 'complete_brief_stage_workflow')
  return data as unknown as CompleteBriefStageWorkflowResult
}

export interface PropagateBriefCompletionResult {
  brief_id: string
  closed?: boolean
  pending_stages?: number
  already_terminal?: boolean
  promoted_brief_id?: string | null
}

/**
 * propagate_brief_completion — closes Brief if all stages terminal;
 * emits brief_completed; auto-promotes next queued Brief on document.
 * Idempotent on already-completed/cancelled Briefs.
 */
export async function propagateBriefCompletion(
  supabase: SupabaseClient,
  briefId: string,
): Promise<PropagateBriefCompletionResult> {
  const { data, error } = await supabase.rpc('propagate_brief_completion', {
    p_brief_id: briefId,
  })
  if (error) throw new BriefRpcError(error.message, error.code, 'propagate_brief_completion')
  return data as unknown as PropagateBriefCompletionResult
}

/**
 * promote_next_queued_brief — manually advance the queue head.
 * Returns the promoted Brief id, or null if no queued Brief exists.
 */
export async function promoteNextQueuedBrief(
  supabase: SupabaseClient,
  documentId: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('promote_next_queued_brief', {
    p_document_id: documentId,
  })
  if (error) throw new BriefRpcError(error.message, error.code, 'promote_next_queued_brief')
  return (data as string | null) ?? null
}
