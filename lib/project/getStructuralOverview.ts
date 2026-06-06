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
  const children: ChildSummary[] = data.map((r) => ({
    id: r.id,
    nodeType: r.node_type,
    order: r.order,
    name: r.name,
    status: r.status,
    isLeaf: max !== undefined && r.layer_index === max,
    wordCountActual: r.word_count_actual,
    wordCountTarget: r.word_count_target,
  }))
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
