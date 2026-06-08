// Phase 8.01.D T-6 — per-project aggregates for the ProjectGrid cards.
//
// Phase 8.5b B.1 rewrite — sum of node aggregates now lives in Postgres
// via the `get_project_rollup` RPC (M-212). The previous TS-side
// implementation read all structural nodes across the org into memory
// and summed client-side; that pattern hit the PostgREST 1000-row
// response cap and silently under-counted any org with > 1000 structural
// nodes total (one large novel was enough; the Mega Manuscript fixture
// reproduced the bug — dashboard displayed 187,206 of the real 500,006
// words). The wrapper preserves the public function signature so
// existing callers (DashboardClient + tests) don't move.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §4
//       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 work item 8
//       docs/stelavox_phase8_5b_test_plan_v1_0.md §1 (TC-8.5b-B1-11..14)
//
// Aggregate semantics are preserved exactly — wordsDrafted is the sum
// of leaf word_count_actual; wordsTarget is the root node's target if
// > 0, otherwise the sum of leaf targets (the round-3 follow-up logic
// from 8.01 — see comments in v1.0 of this file for the rationale).
// Both are now computed inside the RPC; the call site just consumes.
//
// Performance: this rewrites N+1 queries (1 projects scan + N parallel
// rollup RPCs) instead of the previous 2 queries. Each rollup RPC runs
// against a per-document indexed scan that's sub-50 ms on documents up
// to ~10,000 nodes. For a user with 50 projects the total wall-clock
// is dominated by the slowest single rollup, not the sum, because they
// run in parallel through the Supabase pooler.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getProjectRollup } from '@/lib/queries/rollups'
import type { Database } from '@/lib/types/database'

type AppSupabase = SupabaseClient<Database>

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

const LAYER_STACK_LABEL: Record<string, string> = {
  novel: 'NOVEL · Book → Act → Ch → Sc → Bt',
  series: 'SERIES OF NOVELS · Series → Book → Act → Ch → Sc → Bt',
  short_story: 'SHORT STORY · Story → Scene → Beat',
}

export async function getProjectAggregates(
  supabase: AppSupabase,
  orgId: string,
): Promise<ProjectAggregate[]> {
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, description, default_document_type, metadata')
    .eq('organisation_id', orgId)
    .order('updated_at', { ascending: false })
    .returns<ProjectRow[]>()
  if (!projects || projects.length === 0) return []

  // Fan out: one rollup RPC per project, executed in parallel through
  // the Supabase pooler. Each RPC returns one row of aggregates computed
  // in Postgres — no row caps, no TS-side summing.
  //
  // The RPC's COALESCE branch guarantees a zero-filled row even for
  // projects with no documents, so we never have to coalesce nulls.
  const rollups = await Promise.all(
    projects.map((p) => getProjectRollup(supabase as unknown as SupabaseClient, p.id))
  )

  return projects.map((p, i) => {
    const r = rollups[i]!
    const stackType =
      typeof p.default_document_type === 'string' && p.default_document_type
        ? p.default_document_type
        : 'novel'
    return {
      projectId: p.id,
      projectName: p.name,
      description: p.description,
      layerStackLabel: LAYER_STACK_LABEL[stackType] ?? `${stackType.toUpperCase()}`,
      lastUpdatedAt: r.last_updated_at,
      documentCount: r.document_count,
      wordsDrafted: r.words_drafted,
      // RPC already applies the root-target-with-leaf-fallback rule
      // inside the SQL (see migration 20260608000212 — the CASE WHEN
      // root_target > 0 THEN root_target ELSE leaf_target END branch
      // in get_document_rollup, propagated through per_doc_effective_target
      // in get_project_rollup).
      wordsTarget: r.words_target,
      isSample: Boolean((p.metadata ?? {})['is_sample']),
    }
  })
}
