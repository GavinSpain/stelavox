// Spec: stelavox_phase2_api_contract_v1_0.md §3.3 (GET), §3.4 (PATCH), §3.5 (DELETE)
//       stelavox_phase2_test_plan_v1_0.md TC-A-34 to TC-A-74
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.3 T-3.4
//
// Three handlers for /api/nodes/[nodeId]:
//   GET    — read a single node (§3.3)
//   PATCH  — update mutable fields (§3.4). Lock checks ordered: node
//            itself, then ancestors. Version handling is delegated to
//            the M-023 BEFORE-UPDATE trigger.
//   DELETE — remove a node + its descendants (cascade in DB) and
//            renumber surviving siblings to keep order dense (§2.11.5).
//
// Auth (RLS) is at the database layer — these handlers never filter
// by user_id.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { err } from '@/lib/api/errors'
import { isValidUuid } from '@/lib/validation/uuid'
import { nodePatchSchema } from '@/lib/validation/nodes'
import { getNode, updateNode, deleteNode } from '@/lib/data/nodes'

interface Context { params: Promise<{ nodeId: string }> }

type SupabaseRouteClient = Awaited<ReturnType<typeof createClient>>

// Walk parent_id chain upward from `startId`. Returns true if any node
// in the chain has locked = TRUE. Same as the helper in
// app/api/documents/[documentId]/nodes/route.ts; duplicated here to
// avoid coupling the two route files.
async function ancestorChainLocked(
  supabase: SupabaseRouteClient,
  startId: string | null,
): Promise<boolean> {
  let currentId: string | null = startId
  while (currentId !== null) {
    const { data } = await supabase
      .from('nodes')
      .select('parent_id, locked')
      .eq('id', currentId)
      .maybeSingle()
    if (!data) return false
    if (data.locked) return true
    currentId = data.parent_id
  }
  return false
}

// Map a Zod issue from nodePatchSchema to a 400 error helper. Mirrors
// the POST mapping in the documents/[id]/nodes/route, with added
// PATCH-only fields (status, locked, lock_reason).
function mapPatchZodIssue(parsed: ReturnType<typeof nodePatchSchema.safeParse>) {
  if (parsed.success) return null
  const issue = parsed.error.issues[0]
  if (issue?.code === 'unrecognized_keys') {
    const key = Array.isArray((issue as { keys?: unknown }).keys)
      ? String(((issue as { keys: unknown[] }).keys)[0] ?? '')
      : ''
    return err.unknownField(key)
  }
  const path0 = issue?.path[0]
  if (path0 === 'name')              return err.invalidName()
  if (path0 === 'short_description') return err.invalidShortDescription()
  if (path0 === 'status')            return err.invalidStatus()
  if (path0 === 'agent_instruction') return err.invalidAgentInstruction()
  if (path0 === 'word_count_target') return err.invalidWordCountTarget()
  if (path0 === 'summary')           return err.invalidSummary()
  if (path0 === 'prose')             return err.invalidProse()
  if (path0 === 'notes')             return err.invalidNotes()
  if (path0 === 'metadata')          return err.invalidMetadata()
  if (path0 === 'locked')            return err.invalidLocked()
  if (path0 === 'lock_reason')       return err.invalidLockReason()
  return err.invalidName()
}

// Count descendants of `targetId` within `documentId`. One flat query
// over the document's nodes, then BFS in JS via parent_id linkage.
// Phase 2 trees are < 5,000 nodes per document; this is O(N).
async function countDescendants(
  supabase: SupabaseRouteClient,
  documentId: string,
  targetId: string,
): Promise<number> {
  const { data: allRows } = await supabase
    .from('nodes')
    .select('id, parent_id')
    .eq('document_id', documentId)
  if (!allRows) return 0

  const childrenByParent = new Map<string | null, string[]>()
  for (const r of allRows) {
    const arr = childrenByParent.get(r.parent_id) ?? []
    arr.push(r.id)
    childrenByParent.set(r.parent_id, arr)
  }

  let count = 0
  const queue: string[] = [...(childrenByParent.get(targetId) ?? [])]
  while (queue.length > 0) {
    const id = queue.shift()!
    count += 1
    queue.push(...(childrenByParent.get(id) ?? []))
  }
  return count
}

// After a DELETE, decrement `order` by 1 for every sibling whose order
// was greater than the deleted node's order. Phase 2 sibling counts are
// small (<20 typical) so sequential UPDATEs are acceptable.
//
// Implementation note: PostgREST treats `order` as a reserved query
// parameter name (used for ORDER BY). A filter like .gt('order', N)
// emits `?order=gt.N` which PostgREST parses as a (malformed) order-by
// clause rather than a filter — silently dropping it. Workaround: fetch
// all siblings under the parent and filter in JS.
//
// Known atomicity gap: this runs AFTER the DELETE commits. If the route
// process dies between the DELETE and the renumber, the affected
// parent's children will have a sparse `order` (one gap). The data is
// recoverable manually. A delete_node_with_renumber RPC (analogous to
// move_node) would close the gap; documented as Phase 6 hardening.
async function renumberSiblingsAfterDelete(
  supabase: SupabaseRouteClient,
  parentId: string,
  deletedOrder: number,
): Promise<void> {
  const { data: allSiblings } = await supabase
    .from('nodes')
    .select('id, order')
    .eq('parent_id', parentId)
  if (!allSiblings) return

  const toRenumber = allSiblings
    .filter(s => s.order > deletedOrder)
    .sort((a, b) => a.order - b.order)

  for (const s of toRenumber) {
    await supabase
      .from('nodes')
      .update({ order: s.order - 1, updated_at: new Date().toISOString() })
      .eq('id', s.id)
  }
}

// ─── GET ──────────────────────────────────────────────────────────────

export async function GET(_request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    return NextResponse.json({ node })
  } catch {
    return err.internal()
  }
}

// ─── PATCH ────────────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return err.invalidJson()

    let body: unknown
    try { body = await request.json() } catch { return err.invalidJson() }
    if (!body) return err.missingBody()

    const parsed = nodePatchSchema.safeParse(body)
    const zodErr = mapPatchZodIssue(parsed)
    if (zodErr) return zodErr
    if (!parsed.success) return err.internal()  // unreachable; satisfies TS narrowing

    if (Object.keys(parsed.data).length === 0) return err.emptyUpdate()

    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    if (node.locked) return err.nodeLocked()
    if (await ancestorChainLocked(supabase, node.parent_id)) return err.parentLocked()

    const updateFields: Record<string, unknown> = { ...parsed.data }
    // metadata Zod-typed as Record<string, unknown> needs the Json cast
    // for the typed updateNode signature.
    const { data: updated, error: updateError } = await updateNode(
      supabase,
      nodeId,
      updateFields as never,
    )
    if (updateError || !updated) return err.internal()

    return NextResponse.json({ node: updated })
  } catch {
    return err.internal()
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    const { nodeId } = await params
    if (!isValidUuid(nodeId)) return err.invalidUuid()

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return err.unauthorised()

    // Body must be empty. If there's no body the JSON parse throws —
    // that's the OK path. If there's a body with keys → unexpected_body.
    let body: unknown = null
    try { body = await request.json() } catch { /* empty body is fine */ }
    if (body && typeof body === 'object' && Object.keys(body as object).length > 0) {
      return err.unexpectedBody()
    }

    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    if (node.parent_id === null) return err.cannotDeleteRoot()

    if (node.locked) return err.nodeLocked()
    if (await ancestorChainLocked(supabase, node.parent_id)) return err.parentLocked()

    const descendantsCount = await countDescendants(supabase, node.document_id!, node.id)
    const deletedOrder = node.order
    const parentId = node.parent_id

    const { error: deleteError } = await deleteNode(supabase, nodeId)
    if (deleteError) return err.internal()

    await renumberSiblingsAfterDelete(supabase, parentId, deletedOrder)

    return NextResponse.json({
      deleted: true,
      node_id: node.id,
      descendants_deleted: descendantsCount,
    })
  } catch {
    return err.internal()
  }
}
