// Phase 8.5b B.4 — Server-side document-tree prefetch helper.
//
// Wraps the listNodes + decorate-with-leaf + lock-join pipeline that
// app/api/documents/[documentId]/nodes/route.ts has been running inline.
// Now used by BOTH the API route (so behaviour is byte-stable) AND the
// document-page server component (for the RSC dehydration seed per
// Tier-A §3.6).
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.6 + §3.6.2
//       app/api/documents/[documentId]/nodes/route.ts
//       lib/data/nodes.ts (listNodes + decorateWithLeaf + getDocumentMaxLayerIndex)
//
// Contract:
//   - Always uses the structural projection (default per B.2 flip).
//     Callers wanting prose/summary/etc. continue through the route
//     handler with explicit ?include=.
//   - Returns rows depth-first sorted per the existing API contract
//     §3.2 / TC-A-26.
//   - Decorates every row with `is_leaf` (per H-15) and `locked`
//     (from node_author_locks per M-152).
//   - Empty / cross-org / RLS-filtered results return an empty array.

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/types/database'
import {
  listNodes,
  getDocumentMaxLayerIndex,
  decorateWithLeaf,
} from '@/lib/data/nodes'

type Client = SupabaseClient<Database>
type NodeRow = Database['public']['Tables']['nodes']['Row']

// Depth-first sort over a flat node array. O(N) using parent_id linkage.
// Per API Contract §3.2 / TC-A-26: response order is root → A → A's
// subtree → B → B's subtree, etc. Children of each parent visited in
// `order` ascending. Mirrors the helper inline in the route handler.
function depthFirstSort<T extends { id: string; parent_id: string | null; order: number }>(
  rows: T[],
): T[] {
  const childrenByParent = new Map<string | null, T[]>()
  for (const r of rows) {
    const arr = childrenByParent.get(r.parent_id) ?? []
    arr.push(r)
    childrenByParent.set(r.parent_id, arr)
  }
  for (const arr of childrenByParent.values()) arr.sort((a, b) => a.order - b.order)

  const result: T[] = []
  function visit(parentId: string | null) {
    for (const child of childrenByParent.get(parentId) ?? []) {
      result.push(child)
      visit(child.id)
    }
  }
  visit(null)
  return result
}

/**
 * Fetches the document's structural nodes with the default (B.2-flipped)
 * projection, sorts depth-first, decorates with `is_leaf` + `locked`,
 * and returns the array. Used by:
 *   - GET /api/documents/[id]/nodes (default path)
 *   - app/(app)/projects/[p]/documents/[d]/page.tsx (RSC seed prefetch)
 *
 * Errors propagate as thrown exceptions. RLS denials surface as empty
 * arrays (the underlying listNodes is RLS-scoped).
 */
export async function getDocumentNodesProjected(
  supabase: Client,
  documentId: string,
): Promise<Array<NodeRow & { is_leaf: boolean; locked: boolean }>> {
  const { data, error } = await listNodes(supabase, documentId, 'structural', 'structural')
  if (error) throw new Error(`getDocumentNodesProjected: ${error.message}`)
  if (!data || data.length === 0) return []

  const sorted = depthFirstSort(data as unknown as Array<NodeRow & { id: string; parent_id: string | null; order: number }>)

  // Resolve the document's max layer index once for the is_leaf
  // decoration. Catch the H-14 / H-15 throws so cross-org / empty-stack
  // cases degrade gracefully (server-component prefetch shouldn't 500
  // a whole page on a single doc's data-integrity issue).
  let maxIdx: number | null = null
  try {
    maxIdx = await getDocumentMaxLayerIndex(supabase, documentId)
  } catch {
    maxIdx = null
  }

  // One LEFT-JOIN-shaped fetch for lock state per Phase 6 M-152.
  const { data: locks } = await supabase
    .from('node_author_locks')
    .select('node_id')
  const lockedSet = new Set((locks ?? []).map((l) => l.node_id as string))

  return sorted.map((row) => ({
    ...decorateWithLeaf(row as NodeRow, maxIdx),
    locked: lockedSet.has(row.id),
  }))
}
