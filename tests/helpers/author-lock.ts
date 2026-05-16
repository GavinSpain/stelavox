/**
 * Phase 6 test helper — set / clear an Author Lock via the
 * `node_author_locks` table (post-M-154).
 *
 * Replaces direct `.update({ locked: true })` against the nodes
 * table, which is no longer valid after Phase 6.B dropped the
 * nodes.locked / lock_reason / locked_at / locked_version columns.
 *
 * Tests should still go through the production write path
 * (apply_author_lock RPC) for end-to-end coverage; this helper is
 * only for fixture setup where the test isn't validating the lock
 * action itself.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

type AnyClient = SupabaseClient<any, any, any>

export async function setAuthorLockDirect(
  svc: AnyClient,
  args: {
    nodeId: string
    organisationId: string
    lockedByUserId: string
    lockReason?: string | null
    bulkOperationId?: string | null
  },
) {
  const { error } = await svc.from('node_author_locks').insert({
    node_id: args.nodeId,
    organisation_id: args.organisationId,
    locked_by_user_id: args.lockedByUserId,
    lock_reason: args.lockReason ?? null,
    bulk_operation_id: args.bulkOperationId ?? null,
  })
  if (error) throw new Error(`setAuthorLockDirect: ${error.message}`)
}

export async function clearAuthorLockDirect(svc: AnyClient, nodeId: string) {
  await svc.from('node_author_locks').delete().eq('node_id', nodeId)
}
