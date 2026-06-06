// Phase 8.01.D T-7 — QuickStartChecklist completion.
//
// Per OQ-2 lock: completion is derived server-side from 5 EXISTS queries
// against tables we're already maintaining. No new schema, no per-event
// wire-up. localStorage holds only the "dismissed condensed banner" UI
// state.

import type { SupabaseClient } from '@supabase/supabase-js'

import { getMaxLayerIndexByDocument } from '@/lib/data/nodes'

export interface QuickStartCompletion {
  signedIn: boolean
  hasProject: boolean
  hasBeatWithProse: boolean
  hasTriedDirector: boolean
  hasCompletedExport: boolean
}

export const QUICK_START_ITEM_IDS = [
  'signed_in',
  'has_project',
  'has_beat_with_prose',
  'has_tried_director',
  'has_completed_export',
] as const

export type QuickStartItemId = (typeof QUICK_START_ITEM_IDS)[number]

/**
 * Pure helper: counts how many items are done. Used to drive the
 * "Setup complete ✓" condensation per Component Spec v2.21 §18.6.
 */
export function countCompleted(c: QuickStartCompletion): number {
  return (
    (c.signedIn ? 1 : 0) +
    (c.hasProject ? 1 : 0) +
    (c.hasBeatWithProse ? 1 : 0) +
    (c.hasTriedDirector ? 1 : 0) +
    (c.hasCompletedExport ? 1 : 0)
  )
}

export function allComplete(c: QuickStartCompletion): boolean {
  return countCompleted(c) === 5
}

/**
 * Server-side: compute the 5 booleans by 5 cheap EXISTS queries.
 * Caller passes an authenticated supabase client + the user's org id.
 */
export async function getQuickStartCompletion(
  supabase: SupabaseClient,
  orgId: string,
): Promise<QuickStartCompletion> {
  // H-15: leaf-ness is derived from the document's layer_stack
  // (layer_index === max), not a column on the row. For the
  // `hasBeatWithProse` check we pull a small candidate window of
  // structural rows with non-null prose, then check in TS whether any
  // qualifies as a leaf for its document. 20 candidates is plenty —
  // prose is overwhelmingly written to leaves (synthesise targets
  // leaves; expand on non-leaves doesn't write prose at all). If a
  // user somehow has 20+ non-leaf nodes with prose ahead of any leaf,
  // hasBeatWithProse will momentarily read false; the check is
  // re-evaluated every time the dashboard mounts.
  const [projects, candidates, turns, exports] = await Promise.all([
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .limit(1),
    supabase
      .from('nodes')
      .select('document_id, layer_index')
      .eq('organisation_id', orgId)
      .eq('node_category', 'structural')
      .not('prose', 'is', null)
      .limit(20),
    supabase
      .from('director_turns')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .limit(1),
    supabase
      .from('export_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('queue_status', 'completed')
      .limit(1),
  ])

  let hasBeatWithProse = false
  if (candidates.data && candidates.data.length > 0) {
    const candidateRows = candidates.data as Array<{
      document_id: string
      layer_index: number | null
    }>
    const docIds = Array.from(new Set(candidateRows.map((r) => r.document_id)))
    const maxByDoc = await getMaxLayerIndexByDocument(supabase, docIds)
    for (const row of candidateRows) {
      const max = maxByDoc.get(row.document_id)
      if (max !== undefined && row.layer_index === max) {
        hasBeatWithProse = true
        break
      }
    }
  }

  return {
    signedIn: true, // by definition of reaching this code path
    hasProject: (projects.count ?? 0) > 0,
    hasBeatWithProse,
    hasTriedDirector: (turns.count ?? 0) > 0,
    hasCompletedExport: (exports.count ?? 0) > 0,
  }
}
