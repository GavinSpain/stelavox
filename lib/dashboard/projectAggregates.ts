// Phase 8.01.D T-6 — per-project aggregates for the ProjectGrid cards.
//
// One server-side query that returns the metrics ProjectCard renders:
// docs count, drafted words (sum of leaf actuals), planned size,
// last-updated time, is_sample flag from project metadata.
//
// Phase 8.01 round-3 follow-up — `wordsTarget` switches from "sum of
// leaf word_count_target" to "sum of root-node word_count_target."
// Reason: leaves only exist where the author has fleshed out the
// structure; a partial outline (only some chapters/scenes/beats
// authored) would under-report the planned size and make the bar
// read "complete" when most of the work isn't even outlined. The
// root node (Book or Series) carries the author's intent for the
// document's total size and reads correctly in every state. Falls
// back to leaf-sum when no root carries a target, so projects
// created without a top-level target still get a useful bar.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getMaxLayerIndexByDocument } from '@/lib/data/nodes'

export interface ProjectAggregate {
  projectId: string
  projectName: string
  description: string | null
  layerStackLabel: string
  /** ISO string of the most recent updated_at across the project. */
  lastUpdatedAt: string | null
  documentCount: number
  /** Sum of word_count_actual across leaf nodes with prose. */
  wordsDrafted: number
  /** Sum of root-node word_count_target across all documents (the
   *  author's intent for the document's total size). Falls back to
   *  the sum of leaf word_count_target when no root carries a target. */
  wordsTarget: number
  /** From projects.metadata.is_sample — surfaces the SAMPLE badge. */
  isSample: boolean
}

interface ProjectRow {
  id: string
  name: string
  description: string | null
  default_document_type: string | null
  metadata: Record<string, unknown> | null
}

interface NodeAggregateRow {
  project_id: string
  document_id: string
  parent_id: string | null
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  /** Resolved against the row's document's layer_stack to derive leaf-ness (H-15). */
  layer_index: number | null
}

interface DocRow {
  id: string
  project_id: string
}

const LAYER_STACK_LABEL: Record<string, string> = {
  novel: 'NOVEL · Book → Act → Ch → Sc → Bt',
  series: 'SERIES OF NOVELS · Series → Book → Act → Ch → Sc → Bt',
  short_story: 'SHORT STORY · Story → Scene → Beat',
}

export async function getProjectAggregates(
  supabase: SupabaseClient,
  orgId: string,
): Promise<ProjectAggregate[]> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, default_document_type, metadata')
    .eq('organisation_id', orgId)
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>()
  if (!projects || projects.length === 0) return []

  const projectIds = projects.map((p) => p.id)
  const [{ data: docRows }, { data: nodeRows }] = await Promise.all([
    supabase
      .from('documents')
      .select('id, project_id')
      .in('project_id', projectIds)
      .returns<DocRow[]>(),
    supabase
      .from('nodes')
      .select('project_id, document_id, parent_id, word_count_actual, word_count_target, updated_at, layer_index')
      .in('project_id', projectIds)
      .eq('node_category', 'structural')
      .returns<NodeAggregateRow[]>(),
  ])

  const docCounts = new Map<string, number>()
  for (const d of docRows ?? []) {
    docCounts.set(d.project_id, (docCounts.get(d.project_id) ?? 0) + 1)
  }

  // H-15: derive leaf-ness per document via the layer_stack. Pull
  // max-layer-index for every document referenced by the node rows, in
  // one round-trip, then post-filter in TS.
  const nodeDocIds = Array.from(new Set((nodeRows ?? []).map((n) => n.document_id)))
  const maxByDoc = await getMaxLayerIndexByDocument(supabase, nodeDocIds)

  interface Bucket {
    drafted: number
    /** Sum of leaf word_count_target — used only as a fallback when
     *  no root node carries an authored target. */
    leafTargetFallback: number
    /** Sum of root-node word_count_target (the planned size). */
    rootTarget: number
    lastUpdated: string | null
  }
  const buckets = new Map<string, Bucket>()
  for (const n of nodeRows ?? []) {
    const b: Bucket = buckets.get(n.project_id) ?? {
      drafted: 0,
      leafTargetFallback: 0,
      rootTarget: 0,
      lastUpdated: null,
    }
    const max = maxByDoc.get(n.document_id)
    const isLeaf = max !== undefined && n.layer_index === max
    const isRoot = n.parent_id === null
    if (isLeaf) {
      b.drafted += n.word_count_actual ?? 0
      b.leafTargetFallback += n.word_count_target ?? 0
    }
    if (isRoot) {
      b.rootTarget += n.word_count_target ?? 0
    }
    if (!b.lastUpdated || n.updated_at > b.lastUpdated) {
      b.lastUpdated = n.updated_at
    }
    buckets.set(n.project_id, b)
  }

  return projects.map((p) => {
    const b = buckets.get(p.id) ?? {
      drafted: 0,
      leafTargetFallback: 0,
      rootTarget: 0,
      lastUpdated: null,
    }
    const stackType =
      typeof p.default_document_type === 'string' && p.default_document_type
        ? p.default_document_type
        : 'novel'
    // Root target is the author's intent for the document's total size
    // (Book or Series carries it). When no root carries a target —
    // e.g. older projects authored before this convention — fall back
    // to the leaf-target sum so the bar still shows something useful.
    const wordsTarget = b.rootTarget > 0 ? b.rootTarget : b.leafTargetFallback
    return {
      projectId: p.id,
      projectName: p.name,
      description: p.description,
      layerStackLabel: LAYER_STACK_LABEL[stackType] ?? `${stackType.toUpperCase()}`,
      lastUpdatedAt: b.lastUpdated,
      documentCount: docCounts.get(p.id) ?? 0,
      wordsDrafted: b.drafted,
      wordsTarget,
      isSample: Boolean((p.metadata ?? {})['is_sample']),
    }
  })
}
