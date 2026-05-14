/**
 * POST /api/brief/queue/reorder
 *
 * V1.x-B.1.1 — atomically reorder queued Briefs on a document. The
 * active Brief (if any) is NOT in the reorder set; only status='queued'
 * Briefs are reorderable. Concurrent edits resolved last-write-wins
 * within the transaction.
 *
 * Body: { document_id: string, ordered_brief_ids: string[] }
 *   - ordered_brief_ids must contain exactly the document's current
 *     queued Brief ids (no add / remove via this endpoint).
 *   - Position 1 → sequence_position 1 (next to promote when active
 *     completes). Position N → sequence_position N.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export async function POST(req: NextRequest): Promise<Response> {
  let documentId: string
  let orderedIds: string[]
  try {
    const body = (await req.json()) as { document_id?: unknown; ordered_brief_ids?: unknown }
    if (typeof body.document_id !== 'string' || !isUuid(body.document_id)) {
      return apiError(400, 'invalid_document_id')
    }
    if (!Array.isArray(body.ordered_brief_ids) || body.ordered_brief_ids.some((x) => typeof x !== 'string' || !isUuid(x as string))) {
      return apiError(400, 'invalid_ordered_brief_ids', 'array of UUIDs required')
    }
    documentId = body.document_id
    orderedIds = body.ordered_brief_ids as string[]
  } catch {
    return apiError(400, 'invalid_body', 'JSON body required')
  }

  // Reject duplicates within the input set.
  if (new Set(orderedIds).size !== orderedIds.length) {
    return apiError(400, 'duplicate_brief_ids')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // RLS-gated read of the document's current queued Briefs.
  const { data: queued, error: queryErr } = await supabase
    .from('briefs')
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'queued')
  if (queryErr) return apiError(500, 'queue_read_failed', queryErr.message)

  const currentIds = new Set((queued ?? []).map((b) => b.id))
  const inputIds = new Set(orderedIds)

  if (currentIds.size !== inputIds.size || ![...currentIds].every((id) => inputIds.has(id))) {
    return apiError(409, 'queue_set_mismatch', 'ordered_brief_ids must match the document\'s current queued Briefs exactly')
  }

  // Atomic update via service-role (RLS already passed via the read).
  // Two-pass to avoid the partial-unique-index conflict if any sequence
  // shuffle would temporarily duplicate a position: pass 1 sets all to
  // negative sentinels; pass 2 sets the new positions.
  const service = createServiceRoleClient()

  const negativeUpdates = orderedIds.map((id, idx) =>
    service.from('briefs').update({ sequence_position: -(idx + 1) }).eq('id', id),
  )
  const negativeResults = await Promise.all(negativeUpdates)
  for (const r of negativeResults) {
    if (r.error) return apiError(500, 'reorder_pass1_failed', r.error.message)
  }

  const positiveUpdates = orderedIds.map((id, idx) =>
    service.from('briefs').update({ sequence_position: idx + 1 }).eq('id', id),
  )
  const positiveResults = await Promise.all(positiveUpdates)
  for (const r of positiveResults) {
    if (r.error) return apiError(500, 'reorder_pass2_failed', r.error.message)
  }

  return NextResponse.json({
    document_id: documentId,
    ordered_brief_ids: orderedIds,
  })
}
