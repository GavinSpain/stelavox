/**
 * Phase 6.B — POST + DELETE /api/nodes/[id]/lock
 *
 * POST   proposes an Author Lock. Body: { reason?, with_descendants?,
 *        descendant_ids? }. If with_descendants is true, the caller
 *        supplies the precomputed descendant_ids array (the UI walks
 *        the tree for the user-facing affordance).
 *
 *        Per Phase 6 D3: before applying, calls
 *        propose_author_lock_conflicts. If conflicts exist, returns
 *        423 with { conflicts: LockConflictJob[] } so the UI surfaces
 *        LockConflictModal. No auto-resolve.
 *
 * DELETE releases an Author Lock on the target node. Authorised for
 *        the locker themselves or any org owner (per release_author_lock
 *        RPC in M-153).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { z } from 'zod'
import {
  applyAuthorLock, applyAuthorLockBulk, releaseAuthorLock,
  proposeAuthorLockConflicts,
} from '@/lib/locking/authorLock'

interface Context { params: Promise<{ nodeId: string }> }

const lockPostSchema = z.object({
  reason: z.string().max(1000).nullable().optional(),
  with_descendants: z.boolean().optional(),
  descendant_ids: z.array(z.string().uuid()).max(10000).optional(),
}).strict()

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const ct = request.headers.get('content-type') ?? ''
    if (!ct.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (body === null) body = {}

    const parsed = lockPostSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      if (issue?.code === 'unrecognized_keys') {
        const key = Array.isArray((issue as { keys?: unknown }).keys)
          ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
          : ''
        return err.unknownField(key)
      }
      return err.invalidJson()
    }

    const { reason, with_descendants, descendant_ids } = parsed.data

    // Build the list of nodes that would be locked. The conflict-check
    // covers the target + every descendant (if bulk).
    const targets = [nodeId, ...(with_descendants && descendant_ids ? descendant_ids : [])]

    // Phase 6 D3: pre-emptive conflict check.
    const conflicts = await proposeAuthorLockConflicts(supabase, targets)
    if (conflicts.length > 0) {
      return NextResponse.json(
        {
          error: 'lock_conflict',
          message: 'Pending agent work would conflict with this lock. Resolve the conflicts or try again later.',
          conflicts,
        },
        { status: 423 },
      )
    }

    if (with_descendants) {
      const result = await applyAuthorLockBulk(supabase, {
        nodeId, reason, descendantIds: descendant_ids ?? [],
      })
      return NextResponse.json({
        locked: true,
        node_id: nodeId,
        bulk_operation_id: result.bulkOperationId,
        locked_count: result.lockedCount,
      })
    }

    await applyAuthorLock(supabase, { nodeId, reason })
    return NextResponse.json({ locked: true, node_id: nodeId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('not_found:')) return err.notFound()
    if (msg.startsWith('forbidden:')) return err.unauthorised()
    if (msg.includes('duplicate key value') || msg.includes('already exists')) {
      return NextResponse.json(
        { error: 'already_locked', message: 'This node is already locked.' },
        { status: 409 },
      )
    }
    return err.internal()
  }
}

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    await releaseAuthorLock(supabase, nodeId)
    return NextResponse.json({ unlocked: true, node_id: nodeId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('not_found:')) return err.notFound()
    if (msg.startsWith('forbidden:')) return err.unauthorised()
    return err.internal()
  }
}
