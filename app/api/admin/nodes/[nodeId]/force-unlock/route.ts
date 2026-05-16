/**
 * Phase 6.B — POST /api/admin/nodes/[id]/force-unlock
 *
 * Org-owner emergency unlock. Calls force_unlock RPC (M-153) which
 * checks org-owner role and writes an audit_log row per D5.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { z } from 'zod'
import { forceUnlock } from '@/lib/locking/authorLock'

interface Context { params: Promise<{ nodeId: string }> }

const forceUnlockSchema = z.object({
  reason: z.string().max(2000).nullable().optional(),
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

    const parsed = forceUnlockSchema.safeParse(body)
    if (!parsed.success) return err.invalidJson()

    await forceUnlock(supabase, { nodeId, reason: parsed.data.reason })
    return NextResponse.json({ unlocked: true, node_id: nodeId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.startsWith('not_found:')) return err.notFound()
    if (msg.startsWith('forbidden:')) {
      return NextResponse.json(
        { error: 'forbidden', message: 'Only an organisation owner can force-unlock.' },
        { status: 403 },
      )
    }
    return err.internal()
  }
}
