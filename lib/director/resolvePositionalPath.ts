// Phase 8.01.C T-7.3 — resolve a parsed positional path against a flat
// node array. Walks from root, picking the child where `(node_type, order)`
// matches the current segment. Returns the resolved node or null.
//
// Pure function — caller (NodePicker) provides the array. The array is
// expected to be the full document's structural nodes; context nodes are
// ignored.

import type { PositionalPathSegment } from './parsePositionalPath'

export interface ResolvableNode {
  id: string
  parent_id: string | null
  order: number
  node_type: string
  node_category?: string
}

/**
 * Walk segments root→leaf, finding the child of the current cursor whose
 * (node_type, order) matches each segment. Series segments match
 * `node_type === 'series'` regardless of position.
 *
 * Returns the final matched node or null when:
 *   - any segment doesn't match an existing child
 *   - the root match (first segment) doesn't exist as a structural top-level
 *     node (parent_id IS NULL, node_category === 'structural')
 */
export function resolvePositionalPath<T extends ResolvableNode>(
  segments: PositionalPathSegment[],
  nodes: ReadonlyArray<T>,
): T | null {
  if (segments.length === 0) return null
  // Build parent→children index for fast lookups.
  const structural = nodes.filter(n => (n.node_category ?? 'structural') === 'structural')
  const childrenByParent = new Map<string | null, T[]>()
  for (const n of structural) {
    const arr = childrenByParent.get(n.parent_id) ?? []
    arr.push(n)
    childrenByParent.set(n.parent_id, arr)
  }
  // Root candidates are children of null.
  const rootCandidates: T[] = childrenByParent.get(null) ?? []
  let cursor: T | null = pickMatch(rootCandidates, segments[0])
  if (!cursor) return null
  for (let i = 1; i < segments.length; i++) {
    const cursorId: string = cursor.id
    const kids: T[] = childrenByParent.get(cursorId) ?? []
    const next: T | null = pickMatch(kids, segments[i])
    if (!next) return null
    cursor = next
  }
  return cursor
}

function pickMatch<T extends ResolvableNode>(
  candidates: T[],
  seg: PositionalPathSegment,
): T | null {
  for (const c of candidates) {
    if (c.node_type !== seg.layer) continue
    if (seg.layer === 'series') return c // series ignores position
    if (typeof seg.position === 'number' && c.order === seg.position) return c
  }
  return null
}
