/**
 * Director — write-tool executors.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §1, §2.11 invariant I-2.
 *         stelavox_technical_architecture_v1_9.md §8.3 write tools, H-08.
 * Build Checklist: T-5.
 *
 * Write tools NEVER execute database writes inside the agentic loop (H-08).
 * They produce a WorkflowStepProposal that the executor accumulates; on
 * end-of-turn the accumulated proposals become a workflow row with
 * status='draft' and workflow_steps rows. Execution happens only after
 * the author approves.
 *
 * Each executor:
 *   1. Validates args via lib/director/schemas.ts (already done by the
 *      executor's caller — validateToolCall — but we trust-and-verify).
 *   2. Verifies target_node_id belongs to caller's org/document via a
 *      lightweight lookup. (Cross-org / cross-document is also blocked
 *      at validateToolCall, but the tool re-checks for defence in depth.)
 *   3. Constructs the WorkflowStepProposal and returns it.
 *
 * No state, no side effects.
 */

import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'
import type {
  DirectorSession,
  ToolErrorResult,
  WorkflowStepProposal,
  WriteToolResult,
} from '@/lib/director/types'

type WriteToolReturn = WriteToolResult | ToolErrorResult

/** Lightweight target-node existence + org/document scope check. */
async function verifyTargetNode(
  nodeId: string,
  session: DirectorSession,
): Promise<{ ok: true; locked: boolean } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('nodes')
    .select('id, locked, organisation_id, document_id')
    .eq('id', nodeId)
    .maybeSingle()

  if (error || !data) return { ok: false, error: 'target_node_not_found' }
  if (data.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'cross_org_access_denied' }
  }
  if (data.document_id !== session.document_id) {
    return { ok: false, error: 'cross_document_access_denied' }
  }
  return { ok: true, locked: data.locked }
}

// ---------------------------------------------------------------------------
// create_expand_step
// ---------------------------------------------------------------------------

export async function execCreateExpandStep(
  args: {
    target_node_id: string
    child_count_target?: number
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.locked) return { ok: false, error: 'node_locked' }

  const proposal: WorkflowStepProposal = {
    operation_type: 'expand',
    target_node_id: args.target_node_id,
    parameters: {
      ...(args.child_count_target !== undefined
        ? { child_count_target: args.child_count_target }
        : {}),
    },
    description: args.description,
    estimated_duration_seconds: args.estimated_duration_seconds,
  }

  return { ok: true, proposal }
}

// ---------------------------------------------------------------------------
// create_synthesise_step
// ---------------------------------------------------------------------------

export async function execCreateSynthesiseStep(
  args: {
    target_node_id: string
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.locked) return { ok: false, error: 'node_locked' }

  return {
    ok: true,
    proposal: {
      operation_type: 'synthesise',
      target_node_id: args.target_node_id,
      parameters: {},
      description: args.description,
      estimated_duration_seconds: args.estimated_duration_seconds,
    },
  }
}

// ---------------------------------------------------------------------------
// create_refine_step
// ---------------------------------------------------------------------------

export async function execCreateRefineStep(
  args: {
    target_node_id: string
    target_field: 'summary' | 'prose' | 'notes' | 'metadata'
    instruction: string
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.locked) return { ok: false, error: 'node_locked' }

  return {
    ok: true,
    proposal: {
      operation_type: 'refine',
      target_node_id: args.target_node_id,
      parameters: {
        target_field: args.target_field,
        instruction: args.instruction,
      },
      description: args.description,
      estimated_duration_seconds: args.estimated_duration_seconds,
    },
  }
}

// ---------------------------------------------------------------------------
// create_context_step
// ---------------------------------------------------------------------------

export async function execCreateContextStep(
  args: {
    target_node_id: string
    context_type:
      | 'character'
      | 'location'
      | 'organisation'
      | 'theme'
      | 'plot_thread'
      | 'world'
    seed_content?: string
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.locked) return { ok: false, error: 'node_locked' }

  return {
    ok: true,
    proposal: {
      operation_type: 'generate_context',
      target_node_id: args.target_node_id,
      parameters: {
        context_type: args.context_type,
        ...(args.seed_content !== undefined
          ? { seed_content: args.seed_content }
          : {}),
      },
      description: args.description,
      estimated_duration_seconds: args.estimated_duration_seconds,
    },
  }
}

// ---------------------------------------------------------------------------
// create_comment_step
// ---------------------------------------------------------------------------

export async function execCreateCommentStep(
  args: {
    target_node_id: string
    comment_type: 'instruction' | 'note'
    content: string
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  // Comments are admitted on locked nodes — they don't modify the node.

  return {
    ok: true,
    proposal: {
      operation_type: 'comment',
      target_node_id: args.target_node_id,
      parameters: {
        comment_type: args.comment_type,
        content: args.content,
      },
      description: args.description,
      estimated_duration_seconds: args.estimated_duration_seconds,
    },
  }
}

// ---------------------------------------------------------------------------
// create_node_reorder_step (SU-37 — added for J5 narrative)
// ---------------------------------------------------------------------------

export async function execCreateNodeReorderStep(
  args: {
    target_node_id: string
    new_order: number
    parent_id?: string
    description: string
    estimated_duration_seconds: number
  },
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const v = await verifyTargetNode(args.target_node_id, session)
  if (!v.ok) return { ok: false, error: v.error }
  if (v.locked) return { ok: false, error: 'node_locked' }

  // If parent_id is provided, verify it too (cross-parent reorder).
  if (args.parent_id) {
    const pv = await verifyTargetNode(args.parent_id, session)
    if (!pv.ok) return { ok: false, error: 'parent_' + pv.error }
  }

  return {
    ok: true,
    proposal: {
      operation_type: 'node_reorder',
      target_node_id: args.target_node_id,
      parameters: {
        new_order: args.new_order,
        ...(args.parent_id !== undefined ? { parent_id: args.parent_id } : {}),
      },
      description: args.description,
      estimated_duration_seconds: args.estimated_duration_seconds,
    },
  }
}

// ---------------------------------------------------------------------------
// propose_brief (V1.x-A.1) — operation-level Brief proposal.
// ---------------------------------------------------------------------------

export async function execProposeBrief(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()

  // Confirm caller's org owns the document.
  const { data: doc } = await supabase
    .from('documents')
    .select('id, organisation_id')
    .eq('id', session.document_id)
    .maybeSingle()
  if (!doc || doc.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'document_not_found' }
  }

  // V1.x-B.3 — concurrent Briefs allowed (M-126 dropped the
  // one-active-per-document constraint). The proposal-builder collects
  // soft node-reservation warnings if the proposed stages target nodes
  // already in another active Brief's pending workflow steps; the
  // Director surfaces these in the BriefProposalCard pre-approval.

  const { buildBriefProposal } = await import('@/lib/brief/proposalBuilder')
  try {
    const proposal = buildBriefProposal(args)

    // Collect target node IDs across all stages' workflow steps.
    const proposedTargetNodeIds: string[] = []
    for (const stage of proposal.stages) {
      const workflow = (stage as { workflow?: { steps?: Array<{ target_node_id?: string }> } }).workflow
      if (workflow?.steps) {
        for (const step of workflow.steps) {
          if (step.target_node_id) proposedTargetNodeIds.push(step.target_node_id)
        }
      }
    }

    let concurrentEditWarning: unknown = null
    if (proposedTargetNodeIds.length > 0) {
      const { detectConcurrentEditWarning } = await import('@/lib/brief/nodeReservationWarnings')
      concurrentEditWarning = await detectConcurrentEditWarning(session.document_id, proposedTargetNodeIds)
    }

    return {
      ok: true,
      brief_proposal: {
        goal_text: proposal.goal_text,
        preferences: {},
        stages: proposal.stages.map((s) => ({
          order: s.order,
          title: s.title,
          description: s.description,
          trigger_type: s.trigger_type,
          trigger_config: s.trigger_config as Record<string, unknown>,
        })),
      },
      brief_proposal_full: {
        ...(proposal as unknown as Record<string, unknown>),
        ...(concurrentEditWarning ? { concurrent_edit_warning: concurrentEditWarning } : {}),
      } as Record<string, unknown>,
    } as WriteToolReturn
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'invalid_brief_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------------------------------------------------------------------------
// propose_brief_amendment (V1.x-B.3) — propose-only mutation of active Brief.
// ---------------------------------------------------------------------------
// Per H-08, write tools never execute. The Director recommends an
// amendment; the user approves via BriefAmendmentCard before
// apply_brief_amendment SECURITY DEFINER RPC (M-128) fires.
//
// 5 amendment types (validated by lib/brief/amendments.ts:validateBriefAmendmentProposal):
//   goal_text / preferences / add_stage / modify_pending_stage / remove_pending_stage

export async function execProposeBriefAmendment(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()

  // Validate brief_id belongs to this org's documents.
  const briefId = args.brief_id as string | undefined
  if (!briefId || typeof briefId !== 'string') {
    return { ok: false, error: 'invalid_brief_id', reason: 'brief_id required' }
  }
  const { data: brief } = await supabase
    .from('briefs')
    .select('id, document_id, organisation_id, goal_text, preferences, status')
    .eq('id', briefId)
    .maybeSingle()
  if (!brief || brief.organisation_id !== session.organisation_id || brief.document_id !== session.document_id) {
    return { ok: false, error: 'brief_not_found_in_session_scope' }
  }
  if (brief.status !== 'active' && brief.status !== 'planned') {
    return {
      ok: false,
      error: 'brief_not_amendable',
      reason: `Brief status is ${brief.status}; only active or planned Briefs can be amended.`,
    }
  }

  // Build + validate the proposal artefact.
  const { validateBriefAmendmentProposal } = await import('@/lib/brief/amendments')
  const artefact = {
    brief_id: briefId,
    amendment_type: args.amendment_type as
      | 'goal_text' | 'preferences' | 'add_stage' | 'modify_pending_stage' | 'remove_pending_stage',
    target_path: (args.target_path as string | undefined) ?? null,
    before: (args.before as Record<string, unknown> | undefined) ?? null,
    after: (args.after as Record<string, unknown>) ?? {},
    reason: (args.reason as string | undefined) ?? '',
  }
  try {
    validateBriefAmendmentProposal(artefact)
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'invalid_brief_amendment_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }

  // Defensive: for modify/remove_pending_stage, confirm the target stage
  // exists + is still planned. This is a planning-time hint to the model;
  // the M-128 RPC re-validates at apply time.
  if (artefact.amendment_type === 'modify_pending_stage' || artefact.amendment_type === 'remove_pending_stage') {
    const targetStageId = artefact.target_path
    if (targetStageId) {
      const { data: stage } = await supabase
        .from('brief_stages')
        .select('id, status')
        .eq('id', targetStageId)
        .eq('brief_id', briefId)
        .maybeSingle()
      if (!stage) {
        return { ok: false, error: 'target_stage_not_found' }
      }
      if (stage.status !== 'planned') {
        return {
          ok: false,
          error: 'cannot_modify_non_pending_stage',
          reason: `Stage status is ${stage.status}; only 'planned' stages can be amended.`,
        }
      }
    }
  }

  return {
    ok: true,
    // Use the existing brief_proposal_full slot to round-trip the artefact
    // to the tool_result; iteration-runner pulls it out as the
    // proposal_artefact for the BriefAmendmentCard.
    brief_amendment_proposal: artefact as Record<string, unknown>,
  } as WriteToolReturn
}

// ---------------------------------------------------------------------------
// report_capability_limit (V1.x-F.1) — synthetic propose-only self-rejection.
// ---------------------------------------------------------------------------
// Per H-08, write tools never execute. The Director invokes this tool
// when it detects the user's request exceeds its capability boundaries
// (per-iteration node cap, token-budget headroom, tool-count overflow,
// or a multi-step batch protocol that doesn't fit in one workflow).
//
// There is no underlying DB write or session-scoped lookup — the args
// are pure model output. The user "approves" by reformulating their
// request after reading the suggested alternative; the UI surfaces as
// CapabilityLimitCard in the conversation thread.
//
// Args validation already happened at validateToolCall via the zod
// schema in lib/director/schemas.ts; this executor re-checks the
// presence + non-empty-string invariants for defence in depth.

export async function execReportCapabilityLimit(
  args: Record<string, unknown>,
  _session: DirectorSession,
): Promise<WriteToolReturn> {
  const detectedLimit = args.detected_limit
  const suggestedAlternative = args.suggested_alternative
  const reason = args.reason

  if (
    detectedLimit !== 'per_iteration_cap' &&
    detectedLimit !== 'token_budget' &&
    detectedLimit !== 'tool_count' &&
    detectedLimit !== 'other'
  ) {
    return {
      ok: false,
      error: 'invalid_detected_limit',
      reason: 'detected_limit must be one of per_iteration_cap | token_budget | tool_count | other',
    }
  }
  if (typeof suggestedAlternative !== 'string' || suggestedAlternative.trim().length === 0) {
    return { ok: false, error: 'invalid_suggested_alternative', reason: 'suggested_alternative must be non-empty' }
  }
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    return { ok: false, error: 'invalid_reason', reason: 'reason must be non-empty' }
  }

  return {
    ok: true,
    capability_limit_proposal: {
      detected_limit: detectedLimit,
      suggested_alternative: suggestedAlternative,
      reason,
    },
  } as WriteToolReturn
}

// ---------------------------------------------------------------------------
// cancel_brief (V1.x-B.1.1) — destructive proposal-only.
// ---------------------------------------------------------------------------
// Per H-08, write tools never execute. The Director recommends cancelling
// a specific Brief; the user approves via BriefCancellationProposalCard
// before the cancel_brief RPC fires.
//
// The executor reads the Brief's current status + computes a cascade
// preview (pending vs completed stages, whether a queued Brief will
// promote) so the approval card surfaces accurate impact. The actual
// cancel_brief RPC at approval time computes its own definitive summary.

export async function execCancelBrief(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()

  const briefId = typeof args.brief_id === 'string' ? args.brief_id : null
  const reason = typeof args.reason === 'string' ? args.reason : null
  if (!briefId) {
    return { ok: false, error: 'invalid_brief_id', reason: 'brief_id is required' }
  }
  if (!reason || reason.trim().length === 0) {
    return { ok: false, error: 'invalid_reason', reason: 'reason is required' }
  }

  // Confirm the Brief exists, belongs to the caller's org, and lives on
  // the session's document. Cross-document or cross-org cancellation is
  // denied at the planning surface.
  const { data: brief } = await supabase
    .from('briefs')
    .select('id, document_id, organisation_id, status')
    .eq('id', briefId)
    .maybeSingle()

  if (!brief) {
    return { ok: false, error: 'brief_not_found' }
  }
  if (brief.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'cross_org_access_denied' }
  }
  if (brief.document_id !== session.document_id) {
    return { ok: false, error: 'cross_document_access_denied' }
  }
  if (!['planned', 'queued', 'active'].includes(brief.status)) {
    return {
      ok: false,
      error: 'invalid_status',
      reason: `Cannot cancel a Brief in status "${brief.status}".`,
    }
  }

  // Cascade preview — pending vs completed stages.
  const { data: stages } = await supabase
    .from('brief_stages')
    .select('status')
    .eq('brief_id', briefId)

  const stageRows = (stages ?? []) as Array<{ status: string }>
  const pendingStages = stageRows.filter(
    (s) => !['completed', 'skipped', 'cancelled'].includes(s.status),
  ).length
  const completedStages = stageRows.filter((s) => s.status === 'completed').length

  // Will a queued Brief promote? Only if the cancellation target is the
  // active one AND there's a queued Brief on the document.
  let queuedBriefWillPromote = false
  if (brief.status === 'active') {
    const { count: queuedCount } = await supabase
      .from('briefs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', brief.document_id)
      .eq('status', 'queued')
    queuedBriefWillPromote = (queuedCount ?? 0) > 0
  }

  return {
    ok: true,
    brief_cancellation_proposal: {
      brief_id: briefId,
      reason,
      brief_status_at_proposal: brief.status as 'planned' | 'queued' | 'active',
      cascade_preview: {
        pending_stages: pendingStages,
        completed_stages: completedStages,
        queued_brief_will_promote: queuedBriefWillPromote,
      },
    },
  } as WriteToolReturn
}

// ---------------------------------------------------------------------------
// propose_profile_amendment (V1.x-A.1) — durable preference promotion.
// ---------------------------------------------------------------------------

export async function execProposeProfileAmendment(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('profile_id, organisation_id')
    .eq('id', session.document_id)
    .maybeSingle()
  if (!doc || doc.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'document_not_found' }
  }
  if (!doc.profile_id) {
    return { ok: false, error: 'profile_not_found' }
  }

  const { buildProfileAmendmentProposal } = await import('@/lib/profile/proposalBuilder')
  try {
    const proposal = buildProfileAmendmentProposal(args)
    return {
      ok: true,
      profile_amendment_proposal: {
        amendment_type: proposal.amendment_type,
        target_path: proposal.target_path,
        after: proposal.after,
        reason: proposal.reason,
      },
    } as WriteToolReturn
  } catch (e: unknown) {
    return {
      ok: false,
      error: 'invalid_profile_amendment_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
