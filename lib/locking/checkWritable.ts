/**
 * Phase 6 — unified write-gate wrapper.
 *
 * Calls the `check_node_writable` RPC (M-150) and returns a typed
 * result. Every write endpoint that mutates a node routes through
 * this function instead of bespoke lock checks.
 *
 * On a non-writable result, callers map the blocker to the appropriate
 * 423 error helper:
 *   author_locked     → err.nodeLocked(details)
 *   node_in_use       → err.nodeInUse(details)
 *   node_in_progress  → err.nodeInProgress(details)
 *   not_found         → err.notFound()
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { WriteGateResult } from './types'

type AnyClient = SupabaseClient<any, any, any>

export async function checkNodeWritable(
  supabase: AnyClient,
  nodeId: string,
  requestingUserId: string,
): Promise<WriteGateResult> {
  const { data, error } = await supabase.rpc('check_node_writable', {
    p_node_id: nodeId,
    p_requesting_user_id: requestingUserId,
  })

  if (error) {
    // Surface as not_found — the route handler will translate. We
    // never silently treat an RPC error as writable.
    return { writable: false, blocker: 'not_found', details: null }
  }

  // RPC returns JSONB; supabase-js delivers it as a plain object.
  return data as WriteGateResult
}
