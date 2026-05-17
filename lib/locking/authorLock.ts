/**
 * Phase 6.B — Author Lock RPC wrappers.
 *
 * Thin TS wrappers around the six SECURITY DEFINER functions in M-153.
 * Routes call these instead of direct .from('node_author_locks') CRUD
 * so that the SECURITY DEFINER membership + role checks always run.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface LockConflictJob {
  job_id: string
  node_id: string
  operation_type: string
  status: string
  queue_status: string
  started_at: string
}

export async function proposeAuthorLockConflicts(
  supabase: SupabaseClient,
  nodeIds: string[],
): Promise<LockConflictJob[]> {
  const { data, error } = await supabase.rpc('propose_author_lock_conflicts', {
    p_node_ids: nodeIds,
  })
  if (error) throw new Error(`propose_author_lock_conflicts: ${error.message}`)
  return (data as LockConflictJob[] | null) ?? []
}

export async function applyAuthorLock(
  supabase: SupabaseClient,
  args: { nodeId: string; reason?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('apply_author_lock', {
    p_node_id: args.nodeId,
    p_reason: args.reason ?? null,
  })
  if (error) throw new Error(error.message)
}

export async function applyAuthorLockBulk(
  supabase: SupabaseClient,
  args: { nodeId: string; reason?: string | null; descendantIds: string[] },
): Promise<{ bulkOperationId: string; lockedCount: number }> {
  const { data, error } = await supabase.rpc('apply_author_lock_bulk', {
    p_node_id: args.nodeId,
    p_reason: args.reason ?? null,
    p_descendant_ids: args.descendantIds,
  })
  if (error) throw new Error(error.message)
  const obj = data as { bulk_operation_id: string; locked_count: number }
  return { bulkOperationId: obj.bulk_operation_id, lockedCount: obj.locked_count }
}

export async function releaseAuthorLock(
  supabase: SupabaseClient,
  nodeId: string,
): Promise<void> {
  const { error } = await supabase.rpc('release_author_lock', { p_node_id: nodeId })
  if (error) throw new Error(error.message)
}

export async function releaseBulkOperation(
  supabase: SupabaseClient,
  bulkOperationId: string,
): Promise<{ releasedCount: number }> {
  const { data, error } = await supabase.rpc('release_bulk_operation', {
    p_bulk_operation_id: bulkOperationId,
  })
  if (error) throw new Error(error.message)
  const obj = data as { released_count: number }
  return { releasedCount: obj.released_count }
}

export async function forceUnlock(
  supabase: SupabaseClient,
  args: { nodeId: string; reason?: string | null },
): Promise<void> {
  const { error } = await supabase.rpc('force_unlock', {
    p_node_id: args.nodeId,
    p_reason: args.reason ?? null,
  })
  if (error) throw new Error(error.message)
}
