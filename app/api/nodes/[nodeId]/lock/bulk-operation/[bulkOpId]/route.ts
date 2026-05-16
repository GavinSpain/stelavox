/**
 * Phase 6.B — DELETE /api/nodes/[id]/lock/bulk-operation/[bulkOpId]
 *
 * Releases ALL Author Lock rows sharing a bulk_operation_id. The
 * [nodeId] param identifies the user context (route hierarchy);
 * the actual delete scope is the bulk group.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { releaseBulkOperation } from '@/lib/locking/authorLock'

interface Context { params: Promise<{ nodeId: string; bulkOpId: string }> }

export async function DELETE(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId, bulkOpId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()
    if (!isValidUuid(bulkOpId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const result = await releaseBulkOperation(supabase, bulkOpId)
    return NextResponse.json({
      unlocked: true,
      bulk_operation_id: bulkOpId,
      released_count: result.releasedCount,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('not_found:')) return err.notFound()
    if (msg.startsWith('forbidden:')) return err.unauthorised()
    return err.internal()
  }
}
