// Phase 8.01.E T-3 — non-leaf structure-overview helper.
//
// Returns immediate-children + per-child status + word counts so the new
// non-leaf "structure overview" detail-pane variant (T-4) can render the
// summary + children panel without needing the full subtree.
//
// Server-friendly + client-friendly: takes a SupabaseClient (browser or
// server) and a node id. Uses RLS-scoped reads only.

import type { SupabaseClient } from '@supabase/supabase-js'

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
  is_leaf: boolean
  word_count_actual: number | null
  word_count_target: number | null
}

export async function getStructuralOverview(
  supabase: SupabaseClient,
  nodeId: string,
): Promise<StructuralOverview> {
  const { data, error } = await supabase
    .from('nodes')
    .select('id, node_type, "order", name, status, is_leaf, word_count_actual, word_count_target')
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
  const children: ChildSummary[] = data.map((r) => ({
    id: r.id,
    nodeType: r.node_type,
    order: r.order,
    name: r.name,
    status: r.status,
    isLeaf: r.is_leaf,
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
