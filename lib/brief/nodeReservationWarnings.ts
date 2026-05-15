import 'server-only'

/**
 * V1.x-B.3 — soft node-reservation warnings for concurrent Briefs.
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §3.
 *
 * V1.x-B.1.1 enforced one-active-Brief-per-document via a partial
 * unique index. V1.x-B.3 drops the constraint (M-126); multiple Briefs
 * may be active concurrently. Soft warnings surface at proposal time
 * when a new Brief's stages target nodes that are already in another
 * active Brief's pending workflow steps.
 *
 * The warning is informational — the Director surfaces it in the
 * BriefProposalCard so the user can decide. The system does NOT block
 * concurrent edits; the lock + status state machine in V1.x-D handles
 * actual conflict resolution at agent_job dispatch time.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

export interface ConcurrentEditWarning {
  /** Node IDs that overlap. */
  node_ids: string[]
  /** Existing active Brief IDs that already target these nodes. */
  conflicting_brief_ids: string[]
  /** Human-readable summary for the Director / UI to surface. */
  message: string
}

/**
 * Detect concurrent edit warnings for a proposed Brief.
 *
 * @param documentId - The document the new Brief targets.
 * @param proposedTargetNodeIds - Flattened node IDs from the new Brief's stages' workflow steps.
 * @returns warning if overlap detected; null if clean.
 */
export async function detectConcurrentEditWarning(
  documentId: string,
  proposedTargetNodeIds: string[],
): Promise<ConcurrentEditWarning | null> {
  if (proposedTargetNodeIds.length === 0) return null

  const supabase = createServiceRoleClient()

  // Find all active Briefs on this document with their stages' workflow_ids.
  const { data: activeBriefs } = await supabase
    .from('briefs')
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'active')

  if (!activeBriefs || activeBriefs.length === 0) return null

  const briefIds = activeBriefs.map((b) => b.id)

  // Get the workflow_ids for these briefs' stages (status NOT completed).
  const { data: stages } = await supabase
    .from('brief_stages')
    .select('brief_id, workflow_id')
    .in('brief_id', briefIds)
    .neq('status', 'completed')
    .not('workflow_id', 'is', null)

  if (!stages || stages.length === 0) return null

  const workflowIds = stages.map((s) => s.workflow_id as string)

  // Get the workflow_steps' target_node_ids for those workflows.
  const { data: steps } = await supabase
    .from('workflow_steps')
    .select('workflow_id, target_node_id')
    .in('workflow_id', workflowIds)
    .neq('status', 'completed')
    .not('target_node_id', 'is', null)

  if (!steps || steps.length === 0) return null

  // Intersect with proposed target nodes.
  const proposedSet = new Set(proposedTargetNodeIds)
  const overlapNodes = new Set<string>()
  const overlapWorkflowIds = new Set<string>()
  for (const step of steps) {
    const nodeId = step.target_node_id as string
    if (proposedSet.has(nodeId)) {
      overlapNodes.add(nodeId)
      overlapWorkflowIds.add(step.workflow_id as string)
    }
  }

  if (overlapNodes.size === 0) return null

  // Map the overlapping workflow_ids back to brief_ids.
  const conflictingBriefIds = new Set<string>()
  for (const stage of stages) {
    if (overlapWorkflowIds.has(stage.workflow_id as string)) {
      conflictingBriefIds.add(stage.brief_id as string)
    }
  }

  return {
    node_ids: Array.from(overlapNodes),
    conflicting_brief_ids: Array.from(conflictingBriefIds),
    message: `${overlapNodes.size} node${overlapNodes.size === 1 ? '' : 's'} are already targeted by ${conflictingBriefIds.size} active Brief${conflictingBriefIds.size === 1 ? '' : 's'} on this document. Concurrent edits will create version churn; consider waiting for those Briefs to complete or using a different scope.`,
  }
}
