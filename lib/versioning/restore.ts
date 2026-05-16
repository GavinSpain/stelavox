/**
 * Phase 6.C — restore_node_version RPC wrapper.
 *
 * Thin TS wrapper. Routes call this to invoke restore atomically.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

export type RestoreResult =
  | { ok: true; newVersion: number; restoredFrom: number }
  | { ok: false; error: string; details: Record<string, unknown> | null }

export async function restoreNodeVersion(
  supabase: AnyClient,
  args: { nodeId: string; targetVersion: number; expectedVersion: number },
): Promise<RestoreResult> {
  const { data, error } = await supabase.rpc('restore_node_version', {
    p_node_id: args.nodeId,
    p_target_version: args.targetVersion,
    p_expected_version: args.expectedVersion,
  })
  if (error) {
    return { ok: false, error: 'rpc_error', details: { message: error.message } }
  }
  const result = data as {
    ok: boolean
    error?: string
    details?: Record<string, unknown> | null
    new_version?: number
    restored_from?: number
  }
  if (result.ok) {
    return {
      ok: true,
      newVersion: result.new_version!,
      restoredFrom: result.restored_from!,
    }
  }
  return { ok: false, error: result.error ?? 'unknown', details: result.details ?? null }
}
