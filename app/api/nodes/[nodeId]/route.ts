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
import {
  getNode, updateNode, updateNodeOptimistic, updateNodeOptimisticByContentRevision, deleteNode,
  getDocumentMaxLayerIndex, decorateWithLeaf,
} from '@/lib/data/nodes'
import { countBackLinks } from '@/lib/data/context-links'

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
  if (path0 === 'expected_version')  return err.invalidExpectedVersion()
  if (path0 === 'expected_content_revision') return err.invalidExpectedContentRevision()
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

    // Phase 3 v1.1: decorate with server-derived is_leaf (API Contract §2.12).
    const maxIdx = node.document_id
      ? await getDocumentMaxLayerIndex(supabase, node.document_id)
      : null
    return NextResponse.json({ node: decorateWithLeaf(node, maxIdx) })
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

    // Phase 3 (T-4.4): split the no-settable-fields response.
    //   {}                                        → 400 empty_update
    //   { expected_version: N } only              → 400 missing_body
    //   { expected_content_revision: N } only     → 400 missing_body (J14-1)
    //   anything with content/meta                → proceed
    const parsedKeys = Object.keys(parsed.data)
    const ORTHOGONAL_KEYS = new Set(['expected_version', 'expected_content_revision'])
    const settableKeys = parsedKeys.filter(k => !ORTHOGONAL_KEYS.has(k))
    if (settableKeys.length === 0) {
      if ('expected_version' in parsed.data || 'expected_content_revision' in parsed.data) {
        return err.missingBody()
      }
      return err.emptyUpdate()
    }

    // Strip the orthogonal tokens before the UPDATE. The trigger handles
    // version + content_revision bumping; clients cannot send those fields
    // (rejected by .strict()).
    const {
      expected_version: expectedVersion,
      expected_content_revision: expectedContentRevision,
      ...updateFields
    } = parsed.data

    const { data: node } = await getNode(supabase, nodeId)
    if (!node) return err.notFound()

    // Step 10: lock check beats step 11's version check (§2.4 + TC-A-30).
    if (node.locked) return err.nodeLocked()
    if (await ancestorChainLocked(supabase, node.parent_id)) return err.parentLocked()

    // Step 11–12: atomic optimistic UPDATE. With `expected_version` set,
    // the UPDATE's WHERE clause includes `version = expectedVersion`, so
    // a concurrent commit between our read and write produces a 0-row
    // UPDATE which we surface as 409 (TC-A-32). When omitted, the Phase 2
    // last-write-wins path is preserved verbatim.
    // Phase 3 v1.1: every node response carries server-derived is_leaf
    // (§2.12). Fetch maxLayerIndex once for the document and decorate every
    // returned node body — including the `current` field on a 409.
    const docId = node.document_id
    const maxIdx = docId
      ? await getDocumentMaxLayerIndex(supabase, docId)
      : null

    // SU-J14-1: autosave-driven PATCH uses expected_content_revision.
    // Prefer this over expected_version when both are present — content
    // revision is the stronger anchor (bumps on every save) so it always
    // catches the more recent conflict.
    if (expectedContentRevision !== undefined) {
      const { data: updated, error: updateError } = await updateNodeOptimisticByContentRevision(
        supabase,
        nodeId,
        updateFields as never,
        expectedContentRevision,
      )
      if (updateError) return err.internal()
      if (!updated) {
        const { data: current } = await getNode(supabase, nodeId)
        if (!current) return err.notFound()
        return err.contentRevisionConflict(
          decorateWithLeaf(current, maxIdx),
          expectedContentRevision,
          (current as { content_revision: number }).content_revision,
        )
      }
      return NextResponse.json({ node: decorateWithLeaf(updated, maxIdx) })
    }

    if (expectedVersion !== undefined) {
      const { data: updated, error: updateError } = await updateNodeOptimistic(
        supabase,
        nodeId,
        updateFields as never,
        expectedVersion,
      )
      if (updateError) return err.internal()
      if (!updated) {
        // No row matched (id, version=expectedVersion). Either version
        // mismatch or the row was deleted in the gap. Re-read to decide.
        const { data: current } = await getNode(supabase, nodeId)
        if (!current) return err.notFound()
        return err.versionConflict(
          decorateWithLeaf(current, maxIdx),
          expectedVersion,
          current.version,
        )
      }
      return NextResponse.json({ node: decorateWithLeaf(updated, maxIdx) })
    }

    const { data: updated, error: updateError } = await updateNode(
      supabase,
      nodeId,
      updateFields as never,
    )
    if (updateError || !updated) return err.internal()

    return NextResponse.json({ node: decorateWithLeaf(updated, maxIdx) })
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

    // Phase 4: context-node delete branches off here. The existing
    // structural cannot_delete_root and sibling-renumber logic does
    // not apply to context nodes (they have no parent and no siblings
    // in the structural tree).
    if (node.node_category === 'context') {
      if (node.locked) return err.nodeLocked()

      // §2.11 invariant 11: default DELETE returns 409 with the count
      // unless ?force=true is supplied. The FK ON DELETE CASCADE on
      // node_context_links does the actual link cleanup either way.
      const { searchParams } = new URL(request.url)
      const force = searchParams.get('force') === 'true'
      if (!force) {
        const count = await countBackLinks(supabase, nodeId)
        if (count > 0) return err.cannotDeleteWithBackLinks(count)
      }

      const { error: deleteError } = await deleteNode(supabase, nodeId)
      if (deleteError) return err.internal()
      return NextResponse.json({ deleted: true, node_id: node.id })
    }

    // Structural-node delete (Phase 2 path, unchanged).
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
