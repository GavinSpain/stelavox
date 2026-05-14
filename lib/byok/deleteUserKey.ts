import 'server-only'

/**
 * V1.x-B.1.2 — Delete the caller's BYOK key.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function deleteUserKey(supabase: SupabaseClient): Promise<{ deleted: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('delete_user_anthropic_key')
  if (error) {
    return { deleted: false, reason: error.message }
  }
  if (!data || typeof data !== 'object') {
    return { deleted: false, reason: 'unexpected_rpc_shape' }
  }
  const d = data as { deleted: boolean; reason?: string }
  return { deleted: d.deleted, reason: d.reason }
}
