/**
 * POST /api/admin/orchestration/force-reset/[documentId]
 *
 * Apollo Phase 6 — the literal Apollo reset button. Cascades-cancel
 * every active brief on the document, plus any orphan workflows /
 * agent_jobs / director_turns. Returns a summary of what was cancelled.
 *
 * After this returns, the document has zero in-flight orchestration
 * entities. Audit_orchestration_state() should return empty for this
 * document.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §12.3.
 *
 * Auth: PLATFORM_ADMIN_EMAILS allowlist. Admin-only because it
 * cancels work the document's authors may not be expecting to lose.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import { isValidUuid } from '@/lib/validation/uuid'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

interface Context {
  params: Promise<{ documentId: string }>
}

export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: Context): Promise<Response> {
  const { documentId } = await params
  if (!isValidUuid(documentId)) {
    return NextResponse.json({ error: 'invalid_document_id' }, { status: 400 })
  }

  const supabase = await createClient()
  const isAdmin = await isPlatformAdmin(supabase)
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const svc = createServiceRoleClient()
  const { data, error } = await svc.rpc('force_reset_document', {
    p_document_id: documentId,
  })
  if (error) {
    return NextResponse.json({ error: 'force_reset_rpc_failed', message: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, result: data })
}
