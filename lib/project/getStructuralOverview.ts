// Phase 8.01.E T-3 — non-leaf structure-overview helper.
//
// Returns immediate-children + per-child status + word counts so the new
// non-leaf "structure overview" detail-pane variant (T-4) can render the
// summary + children panel without needing the full subtree.
//
// Server-friendly + client-friendly: takes a SupabaseClient (browser or
// server) and a node id. Uses RLS-scoped reads only.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getMaxLayerIndexByDocument } from '@/lib/data/nodes'

export interface ChildSummary {
  id: string
  nodeType: string
  order: number
  name: string | null
  status: string
  isLeaf: boolean
  wordCountActual: number | null
  wordCountTarget: number | null
}

export interface StructuralOverview {
  parentId: string
  childCount: number
  /** 0-100 percentage of word_count_actual vs target across leaf descendants among children. Null when no leaf-target is set. */
  draftedPct: number | null
  totalWordsActual: number
  totalWordsTarget: number
  children: ChildSummary[]
}

interface ChildRow {
  id: string
  node_type: string
  order: number
  name: string | null
  status: string
  /** Resolved against the document's layer_stack to derive isLeaf (H-15). */
  layer_index: number | null
  document_id: string
  word_count_actual: number | null
  word_count_target: number | null
}

export async function getStructuralOverview(
  supabase: SupabaseClient,
  nodeId: string,
): Promise<StructuralOverview> {
  // H-15: include layer_index + document_id so we can derive isLeaf in
  // TS via the document's layer_stack. The previous query selected a
  // nonexistent is_leaf column and silently returned an empty overview.
  const { data, error } = await supabase
    .from('nodes')
    .select('id, node_type, "order", name, status, layer_index, document_id, word_count_actual, word_count_target')
    .eq('parent_id', nodeId)
    .eq('node_category', 'structural')
    .order('order', { ascending: true })
    .returns<ChildRow[]>()
  if (error || !data) {
    return {
      parentId: nodeId,
      childCount: 0,
      draftedPct: null,
      totalWordsActual: 0,
      totalWordsTarget: 0,
      children: [],
    }
  }
  // All children of a single parent share the same document; derive
  // maxLayerIndex once from the first row's document_id. If there are
  // no children, the leaf-resolution path is moot.
  const documentId = data[0]?.document_id ?? null
  const maxByDoc = documentId
    ? await getMaxLayerIndexByDocument(supabase, [documentId])
    : new Map<string, number>()
  const max = documentId !== null ? maxByDoc.get(documentId) : undefined

  // Round-3 follow-up — aggregate actuals across each child's full
  // subtree, the same way NodeTree.buildTree does for tree rows. The
  // word_count_actual column is only populated on leaf nodes; non-leaf
  // rows read 0 unless we roll up descendants. Pull every structural
  // row in the document once and walk the parent-children map from
  // each immediate child.
  const aggregateByChildId = await computeChildActualAggregates(
    supabase,
    documentId,
    data.map((r) => r.id),
  )

  const children: ChildSummary[] = data.map((r) => {
    const isLeaf = max !== undefined && r.layer_index === max
    // Leaves use their literal actual; non-leaves use the descendant
    // sum. If we didn't resolve max (data integrity), fall back to the
    // literal value.
    const aggregateActual = aggregateByChildId.get(r.id) ?? 0
    const effectiveActual = isLeaf
      ? r.word_count_actual ?? 0
      : aggregateActual
    return {
      id: r.id,
      nodeType: r.node_type,
      order: r.order,
      name: r.name,
      status: r.status,
      isLeaf,
      wordCountActual: effectiveActual,
      wordCountTarget: r.word_count_target,
    }
  })
  const totalWordsActual = children.reduce((s, c) => s + (c.wordCountActual ?? 0), 0)
  const totalWordsTarget = children.reduce((s, c) => s + (c.wordCountTarget ?? 0), 0)
  const draftedPct =
    totalWordsTarget > 0
      ? Math.min(100, Math.round((totalWordsActual / totalWordsTarget) * 100))
      : null
  return {
    parentId: nodeId,
    childCount: children.length,
    draftedPct,
    totalWordsActual,
    totalWordsTarget,
    children,
  }
}

interface DescendantRow {
  id: string
  parent_id: string | null
  word_count_actual: number | null
}

/**
 * For each child id passed in, return the sum of word_count_actual
 * across that child's entire structural subtree (the child included).
 * Pure rollup — does not care about leaf-ness; non-leaf nodes have
 * word_count_actual = 0 by convention so summing all rows is the same
 * as summing only the leaves. Exported for unit tests.
 */
export async function computeChildActualAggregates(
  supabase: SupabaseClient,
  documentId: string | null,
  childIds: readonly string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!documentId || childIds.length === 0) return out
  const { data: allRows } = await supabase
    .from('nodes')
    .select('id, parent_id, word_count_actual')
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .returns<DescendantRow[]>()
  if (!allRows || allRows.length === 0) return out
  // Build children-by-parent map for the whole document.
  const childrenByParent = new Map<string, DescendantRow[]>()
  for (const row of allRows) {
    if (row.parent_id === null) continue
    const arr = childrenByParent.get(row.parent_id) ?? []
    arr.push(row)
    childrenByParent.set(row.parent_id, arr)
  }
  // Memoize subtree-sums so a deep document with many siblings doesn't
  // re-walk shared descendants. Iterative-friendly recursion via a
  // simple cache keyed on node id.
  const subtreeSum = new Map<string, number>()
  function aggregate(id: string, own: number): number {
    const cached = subtreeSum.get(id)
    if (cached !== undefined) return cached
    let total = own
    const kids = childrenByParent.get(id)
    if (kids) {
      for (const kid of kids) {
        total += aggregate(kid.id, kid.word_count_actual ?? 0)
      }
    }
    subtreeSum.set(id, total)
    return total
  }
  // Look up own actuals for each child id in the input set.
  const ownById = new Map<string, number>()
  for (const row of allRows) {
    ownById.set(row.id, row.word_count_actual ?? 0)
  }
  for (const id of childIds) {
    out.set(id, aggregate(id, ownById.get(id) ?? 0))
  }
  return out
}
