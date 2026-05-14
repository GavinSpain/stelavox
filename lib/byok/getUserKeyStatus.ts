import 'server-only'

/**
 * V1.x-B.1.2 — Status reader (no key value).
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserKeyStatus } from './types'

export async function getUserKeyStatus(supabase: SupabaseClient): Promise<UserKeyStatus> {
  const { data, error } = await supabase.rpc('get_user_anthropic_key_status')
  if (error) {
    // Authenticated callers shouldn't see auth errors; surface as absent.
    return { present: false }
  }
  if (!data || (data as { present?: boolean }).present !== true) {
    return { present: false }
  }
  const d = data as { present: true; last_four: string; last_validated_at: string }
  return {
    present: true,
    last_four: d.last_four,
    last_validated_at: d.last_validated_at,
  }
}
