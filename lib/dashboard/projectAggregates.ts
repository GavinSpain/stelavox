// Phase 8.01.D T-6 — per-project aggregates for the ProjectGrid cards.
//
// One server-side query that returns the metrics ProjectCard renders:
// docs count, leaf word totals (drafted + target), last-updated time,
// is_sample flag from project metadata.

import type { SupabaseClient } from '@supabase/supabase-js'

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
  /** Sum of word_count_target across leaf nodes. */
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
  word_count_actual: number | null
  word_count_target: number | null
  updated_at: string
  is_leaf: boolean
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
      .select('project_id, word_count_actual, word_count_target, updated_at, is_leaf')
      .in('project_id', projectIds)
      .eq('node_category', 'structural')
      .returns<NodeAggregateRow[]>(),
  ])

  const docCounts = new Map<string, number>()
  for (const d of docRows ?? []) {
    docCounts.set(d.project_id, (docCounts.get(d.project_id) ?? 0) + 1)
  }

  interface Bucket {
    drafted: number
    target: number
    lastUpdated: string | null
  }
  const buckets = new Map<string, Bucket>()
  for (const n of nodeRows ?? []) {
    const b: Bucket = buckets.get(n.project_id) ?? { drafted: 0, target: 0, lastUpdated: null }
    if (n.is_leaf) {
      b.drafted += n.word_count_actual ?? 0
      b.target += n.word_count_target ?? 0
    }
    if (!b.lastUpdated || n.updated_at > b.lastUpdated) {
      b.lastUpdated = n.updated_at
    }
    buckets.set(n.project_id, b)
  }

  return projects.map((p) => {
    const b = buckets.get(p.id) ?? { drafted: 0, target: 0, lastUpdated: null }
    const stackType =
      typeof p.default_document_type === 'string' && p.default_document_type
        ? p.default_document_type
        : 'novel'
    return {
      projectId: p.id,
      projectName: p.name,
      description: p.description,
      layerStackLabel: LAYER_STACK_LABEL[stackType] ?? `${stackType.toUpperCase()}`,
      lastUpdatedAt: b.lastUpdated,
      documentCount: docCounts.get(p.id) ?? 0,
      wordsDrafted: b.drafted,
      wordsTarget: b.target,
      isSample: Boolean((p.metadata ?? {})['is_sample']),
    }
  })
}
