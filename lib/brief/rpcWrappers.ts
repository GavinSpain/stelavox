import 'server-only'

/**
 * RPC wrappers for Brief lifecycle operations.
 *
 * accept_brief — atomic Brief creation from user-approved proposal.
 * complete_brief_stage — stage finished; advance Brief state.
 * cancel_brief — release the partial unique index slot for a new active Brief.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefProposal, Brief, BriefRpcResult } from './types'

export class BriefRpcError extends Error {
  constructor(message: string, public code: string | undefined, public rpc: string) {
    super(message)
    this.name = 'BriefRpcError'
  }
}

/**
 * accept_brief — atomic insert of briefs + brief_stages rows.
 *
 * The first-stage workflow is NOT created by accept_brief. The API route
 * creates the workflow + workflow_steps separately (using existing Phase
 * 5b workflow creation) and then UPDATEs brief_stages.workflow_id for
 * stage 1.
 */
export async function acceptBrief(
  supabase: SupabaseClient,
  documentId: string,
  proposal: BriefProposal,
): Promise<BriefRpcResult> {
  // Strip the workflow field from stages before sending to the RPC; it
  // operates on stage shape only (title, description, trigger).
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
  return data as unknown as BriefRpcResult
}

export async function completeBriefStage(
  supabase: SupabaseClient,
  stageId: string,
): Promise<BriefRpcResult> {
  const { data, error } = await supabase.rpc('complete_brief_stage', { p_stage_id: stageId })
  if (error) throw new BriefRpcError(error.message, error.code, 'complete_brief_stage')
  return data as unknown as BriefRpcResult
}

export async function cancelBrief(
  supabase: SupabaseClient,
  briefId: string,
): Promise<Brief> {
  const { data, error } = await supabase.rpc('cancel_brief', { p_brief_id: briefId })
  if (error) throw new BriefRpcError(error.message, error.code, 'cancel_brief')
  return data as unknown as Brief
}
