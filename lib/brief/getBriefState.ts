import 'server-only'

/**
 * Server-side reader for the Brief state.
 *
 * Returns the flattened payload defined in V2 doc §6.3 by joining
 * briefs + brief_stages + the most recent brief_amendments.
 *
 * RLS-gated via the standard server Supabase client — only org members
 * see the Brief. Returns null if the Brief is not found or not visible
 * to the caller; the API route maps that to a 404.
 *
 * No caching — the Brief is read fresh on every Director turn that
 * touches it. Brief reads are 1-5 KB, cheap.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BriefStatePayload, BriefStage, BriefAmendment, Brief } from './types'

const RECENT_AMENDMENTS_LIMIT = 5

export async function getBriefState(
  supabase: SupabaseClient,
  briefId: string,
): Promise<BriefStatePayload | null> {
  const briefQ = supabase
    .from('briefs')
    .select('id, document_id, organisation_id, status, goal_text, preferences, current_stage_id, created_at, updated_at, completed_at')
    .eq('id', briefId)
    .maybeSingle()

  const { data: brief, error: briefErr } = await briefQ
  if (briefErr) throw briefErr
  if (!brief) return null

  const [stagesResult, amendmentsResult] = await Promise.all([
    supabase
      .from('brief_stages')
      .select('id, brief_id, order, title, description, trigger_type, trigger_config, status, started_at, completed_at, created_at')
      .eq('brief_id', briefId)
      .order('order', { ascending: true }),
    supabase
      .from('brief_amendments')
      .select('id, brief_id, proposed_by, amendment_type, target_path, before, after, approved_at, approved_by_user_id, reason, created_at')
      .eq('brief_id', briefId)
      .order('approved_at', { ascending: false })
      .limit(RECENT_AMENDMENTS_LIMIT),
  ])

  if (stagesResult.error) throw stagesResult.error
  if (amendmentsResult.error) throw amendmentsResult.error

  const stages = (stagesResult.data ?? []) as unknown as BriefStage[]
  const amendments = (amendmentsResult.data ?? []) as unknown as BriefAmendment[]
  const briefRow = brief as unknown as Brief

  const currentStage = briefRow.current_stage_id
    ? stages.find((s) => s.id === briefRow.current_stage_id) ?? null
    : null

  return {
    goal_text: briefRow.goal_text,
    status: briefRow.status,
    current_stage: currentStage
      ? { order: currentStage.order, title: currentStage.title, status: currentStage.status }
      : null,
    stages: stages.map((s) => ({
      order: s.order,
      title: s.title,
      description: s.description,
      trigger_type: s.trigger_type,
      status: s.status,
    })),
    preferences: briefRow.preferences ?? {},
    recent_amendments: amendments.map((a) => ({
      amendment_type: a.amendment_type,
      target_path: a.target_path,
      reason: a.reason,
      approved_at: a.approved_at,
      proposed_by: a.proposed_by,
    })),
  }
}

/**
 * Convenience: look up a Brief by document_id (1:1) and return its state.
 * Used by the Director executor when assembling the get_brief_state tool
 * result — the Director knows the document_id, not the brief_id.
 */
export async function getBriefStateByDocumentId(
  supabase: SupabaseClient,
  documentId: string,
): Promise<BriefStatePayload | null> {
  const { data, error } = await supabase
    .from('briefs')
    .select('id')
    .eq('document_id', documentId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return getBriefState(supabase, (data as { id: string }).id)
}
