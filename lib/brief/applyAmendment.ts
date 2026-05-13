import 'server-only'

/**
 * Thin wrapper around the apply_brief_amendment SECURITY DEFINER RPC.
 *
 * The RPC mutates briefs.preferences (or briefs.goal_text) and writes a
 * brief_amendments audit row atomically. V1.x-A supports preferences +
 * goal_text amendments only — stage roadmap amendments raise
 * not_implemented_in_v1xa from the RPC.
 *
 * Called from the POST /api/brief/amendments/approve API route after the
 * user approves a Director-proposed amendment.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefAmendmentProposal, BriefRpcResult } from './types'
import { RpcError } from './applyProposal'

export async function applyBriefAmendment(
  supabase: SupabaseClient,
  briefId: string,
  amendment: BriefAmendmentProposal,
): Promise<BriefRpcResult> {
  // For update_goal_text the RPC unwraps the JSONB scalar — pass it as
  // a JSONB-encoded string so the SQL `#>> '{}'` extraction works
  // uniformly.
  const afterPayload =
    amendment.amendment_type === 'update_goal_text' ? amendment.after : amendment.after

  const { data, error } = await supabase.rpc('apply_brief_amendment', {
    p_brief_id: briefId,
    p_amendment_type: amendment.amendment_type,
    p_target_path: amendment.target_path ?? null,
    p_after: afterPayload,
    p_reason: amendment.reason,
  })

  if (error) {
    throw new RpcError(error.message, error.code, 'apply_brief_amendment')
  }
  if (!data || typeof data !== 'object') {
    throw new Error('apply_brief_amendment: unexpected empty result')
  }
  return data as unknown as BriefRpcResult
}
