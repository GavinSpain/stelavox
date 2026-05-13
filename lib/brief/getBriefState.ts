import 'server-only'

/**
 * Server-side reader for the currently-active Brief on a document.
 *
 * V1.x-A.1: returns the single active Brief (status IN ('planned','active'))
 * or null if none. Multi-Brief concurrency is V1.x-B.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Brief, BriefStage, BriefStatePayload } from './types'

export async function getActiveBriefForDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<BriefStatePayload | null> {
  const { data: briefs, error } = await supabase
    .from('briefs')
    .select('id, document_id, organisation_id, goal_text, status, current_stage_id, created_at, approved_at, started_at, completed_at, cancelled_at')
    .eq('document_id', documentId)
    .in('status', ['planned', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  const brief = (briefs ?? [])[0] as unknown as Brief | undefined
  if (!brief) return null

  return assembleBriefStatePayload(supabase, brief)
}

/** Look up a specific Brief by id and return its state payload. */
export async function getBriefById(
  supabase: SupabaseClient,
  briefId: string,
): Promise<BriefStatePayload | null> {
  const { data, error } = await supabase
    .from('briefs')
    .select('id, document_id, organisation_id, goal_text, status, current_stage_id, created_at, approved_at, started_at, completed_at, cancelled_at')
    .eq('id', briefId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return assembleBriefStatePayload(supabase, data as unknown as Brief)
}

async function assembleBriefStatePayload(
  supabase: SupabaseClient,
  brief: Brief,
): Promise<BriefStatePayload> {
  const { data: stagesData } = await supabase
    .from('brief_stages')
    .select('id, brief_id, order, title, description, trigger_type, trigger_config, status, workflow_id, started_at, completed_at, created_at')
    .eq('brief_id', brief.id)
    .order('order', { ascending: true })

  const stages = (stagesData ?? []) as unknown as BriefStage[]
  const currentStage = brief.current_stage_id
    ? stages.find((s) => s.id === brief.current_stage_id) ?? null
    : null

  return {
    brief_id: brief.id,
    goal_text: brief.goal_text,
    status: brief.status,
    current_stage: currentStage
      ? { order: currentStage.order, title: currentStage.title, status: currentStage.status }
      : null,
    stages: stages.map((s) => ({
      order: s.order,
      title: s.title,
      description: s.description,
      trigger_type: s.trigger_type,
      trigger_config: s.trigger_config,
      status: s.status,
      workflow_id: s.workflow_id,
    })),
  }
}
