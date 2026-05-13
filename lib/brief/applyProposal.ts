import 'server-only'

/**
 * Thin wrapper around the apply_brief_proposal SECURITY DEFINER RPC.
 *
 * The RPC writes to briefs + brief_stages + brief_amendments atomically
 * and returns the populated brief + stages. This wrapper is called from
 * the POST /api/brief/proposals/[id]/approve API route after the user
 * approves a Director-proposed Brief.
 *
 * H-08 discipline: the Director's tool never writes — only proposals are
 * accumulated. The API route is the user-mediated execution point.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefProposal, BriefRpcResult } from './types'

export async function applyBriefProposal(
  supabase: SupabaseClient,
  briefId: string,
  proposal: BriefProposal,
): Promise<BriefRpcResult> {
  const { data, error } = await supabase.rpc('apply_brief_proposal', {
    p_brief_id: briefId,
    p_goal_text: proposal.goal_text,
    p_preferences: proposal.preferences,
    p_stages: proposal.stages,
  })

  if (error) {
    // RPC raised — surface the structured error code.
    throw new RpcError(error.message, error.code, 'apply_brief_proposal')
  }

  if (!data || typeof data !== 'object') {
    throw new Error('apply_brief_proposal: unexpected empty result')
  }
  return data as unknown as BriefRpcResult
}

export class RpcError extends Error {
  constructor(message: string, public code: string | undefined, public rpc: string) {
    super(message)
    this.name = 'RpcError'
  }
}
