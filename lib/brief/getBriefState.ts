import 'server-only'

/**
 * Server-side readers for Brief state.
 *
 * V1.x-B.1.1: getBriefQueueStateForDocument returns the {active, queue}
 * shape consumed by Director get_brief_state and BriefViewer / scheduler
 * UI. V1.x-A.1's single-active reader (getActiveBriefForDocument) and
 * specific-brief reader (getBriefById) preserved for callers that don't
 * need the queue view.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Brief,
  BriefQueueState,
  BriefStage,
  BriefStateLite,
  BriefStatePayload,
} from './types'

const BRIEF_COLUMNS =
  'id, document_id, organisation_id, goal_text, status, sequence_position, cause, current_stage_id, created_at, approved_at, started_at, completed_at, cancelled_at'

export async function getActiveBriefForDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<BriefStatePayload | null> {
  const { data: briefs, error } = await supabase
    .from('briefs')
    .select(BRIEF_COLUMNS)
    .eq('document_id', documentId)
    .eq('status', 'active')
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
    .select(BRIEF_COLUMNS)
    .eq('id', briefId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return assembleBriefStatePayload(supabase, data as unknown as Brief)
}

/**
 * V1.x-B.1.1 — return {active, queue} for a document. Active is the
 * full BriefStatePayload (with stages); queue is the ordered list of
 * approved-but-waiting Briefs as lite shapes.
 */
export async function getBriefQueueStateForDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<BriefQueueState> {
  const active = await getActiveBriefForDocument(supabase, documentId)

  const { data: queuedRows, error: queueErr } = await supabase
    .from('briefs')
    .select(BRIEF_COLUMNS)
    .eq('document_id', documentId)
    .eq('status', 'queued')
    .order('sequence_position', { ascending: true })
  if (queueErr) throw queueErr

  const queuedBriefs = (queuedRows ?? []) as unknown as Brief[]

  const queueIds = queuedBriefs.map((b) => b.id)
  const stageCountMap = new Map<string, number>()
  if (queueIds.length > 0) {
    const { data: stagesAgg, error: stagesErr } = await supabase
      .from('brief_stages')
      .select('brief_id')
      .in('brief_id', queueIds)
    if (stagesErr) throw stagesErr
    for (const row of stagesAgg ?? []) {
      const briefId = (row as { brief_id: string }).brief_id
      stageCountMap.set(briefId, (stageCountMap.get(briefId) ?? 0) + 1)
    }
  }

  const queue: BriefStateLite[] = queuedBriefs.map((b) => ({
    brief_id: b.id,
    goal_text: b.goal_text,
    status: b.status,
    sequence_position: b.sequence_position,
    cause: b.cause,
    stage_count: stageCountMap.get(b.id) ?? 0,
    created_at: b.created_at,
  }))

  return { active, queue }
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
    sequence_position: brief.sequence_position,
    cause: brief.cause,
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
