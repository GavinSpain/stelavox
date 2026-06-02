// Phase 8.01.D T-7 — QuickStartChecklist completion.
//
// Per OQ-2 lock: completion is derived server-side from 5 EXISTS queries
// against tables we're already maintaining. No new schema, no per-event
// wire-up. localStorage holds only the "dismissed condensed banner" UI
// state.

import type { SupabaseClient } from '@supabase/supabase-js'

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
  const [projects, beats, turns, exports] = await Promise.all([
    supabase
      .from('projects')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .limit(1),
    supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('is_leaf', true)
      .not('prose', 'is', null)
      .limit(1),
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
  return {
    signedIn: true, // by definition of reaching this code path
    hasProject: (projects.count ?? 0) > 0,
    hasBeatWithProse: (beats.count ?? 0) > 0,
    hasTriedDirector: (turns.count ?? 0) > 0,
    hasCompletedExport: (exports.count ?? 0) > 0,
  }
}
