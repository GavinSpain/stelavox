// Phase 8.01.B T-2 — ancestor-chain helper for the Focus Mode breadcrumb.
//
// Walks a node's parent_id chain to the root and returns segments in
// root-first order, EXCLUDING the input node itself (the caller renders
// the leaf separately so it can include the `name` for the hover-reveal
// per Component Spec v2.21 §6.2).
//
// Safety: caps the walk at 20 hops, mirroring the M-173 compute_node_depth
// SQL helper. Real document trees are ~5 deep; the cap is defensive
// against cycles (which shouldn't exist by FK + the trigger, but the
// helper does not assume).
//
// Restricts to structural nodes with V1 layer types. Anything outside the
// `series/book/act/chapter/scene/beat` set is skipped. Phase 14 layer-
// stack-aware lookup will replace the hardcoded set — same model as
// LayerLabel (`components/tree/LayerLabel.tsx`).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FocusBreadcrumbSegment } from '@/components/focus/FocusBreadcrumb'
import type { LayerKind } from '@/components/tree/LayerLabel'

const MAX_DEPTH_HOPS = 20

const ALLOWED_LAYERS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

interface AncestorRow {
  id: string
  parent_id: string | null
  node_type: string
  order: number
  node_category: string
}

// Extracted to break a TS inference recursion that triggers TS7022 when
// `maybeSingle<AncestorRow>()` is used inside a `while` loop whose cursor
// updates from the awaited row.
async function fetchRow(
  supabase: SupabaseClient,
  id: string,
): Promise<AncestorRow | null> {
  const { data, error } = await supabase
    .from('nodes')
    .select('id, parent_id, node_type, "order", node_category')
    .eq('id', id)
    .maybeSingle<AncestorRow>()
  if (error || !data) return null
  return data
}

/**
 * Walk the parent chain of `nodeId` up to root. Returns segments in
 * root-first order, EXCLUDING the input node. Each entry carries
 * `{ layer, position }` — `name` is intentionally omitted (spec: only
 * the leaf renders the name on hover-reveal).
 *
 * Returns an empty array when:
 *   - nodeId is itself a root (no parent),
 *   - any ancestor is non-structural (context-typed parent),
 *   - any ancestor has a node_type outside the V1 layer set,
 *   - the walk hits the 20-hop safety cap (treat as broken data).
 */
export async function getAncestorChain(
  supabase: SupabaseClient,
  nodeId: string,
): Promise<FocusBreadcrumbSegment[]> {
  // Look up the input node's parent_id; we don't include the input itself.
  const { data: leaf, error: leafErr } = await supabase
    .from('nodes')
    .select('id, parent_id, node_type, "order", node_category')
    .eq('id', nodeId)
    .maybeSingle<AncestorRow>()
  if (leafErr || !leaf) return []
  if (!leaf.parent_id) return []

  const chain: AncestorRow[] = []
  let cursor: string | null = leaf.parent_id
  let hops = 0

  while (cursor !== null && hops < MAX_DEPTH_HOPS) {
    const row = await fetchRow(supabase, cursor)
    if (!row) return []
    if (row.node_category !== 'structural') return [] // defensive: context ancestor
    if (!ALLOWED_LAYERS.has(row.node_type)) return [] // defensive: unknown V1 layer
    chain.push(row)
    cursor = row.parent_id
    hops += 1
  }

  if (hops >= MAX_DEPTH_HOPS) return [] // cycle / broken data

  // chain is leaf→root order; reverse to root→leaf and map to segments.
  return chain.reverse().map((row) => ({
    layer: row.node_type as LayerKind,
    position: row.order,
  }))
}

/**
 * Pure variant operating on a pre-fetched node array. Useful in unit
 * tests and in clients that already have the document's node tree
 * cached in memory (e.g. NodeTree's flattened state). Same return
 * shape and same defensive rejections as the async version.
 */
export function getAncestorChainSync(
  nodeId: string,
  nodes: ReadonlyArray<AncestorRow>,
): FocusBreadcrumbSegment[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const leaf = byId.get(nodeId)
  if (!leaf || !leaf.parent_id) return []

  const chain: AncestorRow[] = []
  let cursor: string | null = leaf.parent_id
  let hops = 0

  while (cursor !== null && hops < MAX_DEPTH_HOPS) {
    const row = byId.get(cursor)
    if (!row) return []
    if (row.node_category !== 'structural') return []
    if (!ALLOWED_LAYERS.has(row.node_type)) return []
    chain.push(row)
    cursor = row.parent_id
    hops += 1
  }

  if (hops >= MAX_DEPTH_HOPS) return []

  return chain.reverse().map((row) => ({
    layer: row.node_type as LayerKind,
    position: row.order,
  }))
}

/**
 * Exported for unit tests + Phase 14 compatibility shim.
 */
export const ANCESTOR_CHAIN_MAX_DEPTH = MAX_DEPTH_HOPS
