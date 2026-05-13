import 'server-only'

/**
 * Thin wrapper around the apply_profile_amendment SECURITY DEFINER RPC.
 *
 * Called from POST /api/profile/amendments/approve after user approves
 * a Director-proposed amendment.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProfileAmendmentProposal, ProjectProfile } from './types'

export class RpcError extends Error {
  constructor(message: string, public code: string | undefined, public rpc: string) {
    super(message)
    this.name = 'RpcError'
  }
}

export async function applyProfileAmendment(
  supabase: SupabaseClient,
  profileId: string,
  amendment: ProfileAmendmentProposal,
): Promise<ProjectProfile> {
  const { data, error } = await supabase.rpc('apply_profile_amendment', {
    p_profile_id: profileId,
    p_amendment_type: amendment.amendment_type,
    p_target_path: amendment.target_path ?? null,
    p_after: amendment.after,
    p_reason: amendment.reason,
  })
  if (error) throw new RpcError(error.message, error.code, 'apply_profile_amendment')
  if (!data) throw new Error('apply_profile_amendment: empty result')
  return data as unknown as ProjectProfile
}
