/**
 * Phase 6 — write-gate enforcement helper for API routes.
 *
 * Wraps `checkNodeWritable` and returns a NextResponse error when
 * the node is not writable. Routes use this as a one-liner:
 *
 *   const block = await enforceWritable(supabase, nodeId, user.id)
 *   if (block) return block
 *
 * Replaces the bespoke `if (node.locked) return err.nodeLocked()`
 * + `ancestorChainLocked` pattern from Phase 2-V1.x.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { NextResponse } from 'next/server'
import { err } from '@/lib/api/errors'
import { checkNodeWritable } from './checkWritable'

export async function enforceWritable(
  supabase: SupabaseClient,
  nodeId: string,
  requestingUserId: string,
): Promise<NextResponse | null> {
  const result = await checkNodeWritable(supabase, nodeId, requestingUserId)
  if (result.writable) return null
  switch (result.blocker) {
    case 'author_locked': return err.nodeLocked(result.details)
    case 'node_in_use':   return err.nodeInUse(result.details)
    case 'node_in_progress': return err.nodeInProgress(result.details)
    case 'not_found':     return err.notFound()
  }
}
