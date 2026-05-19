/**
 * Director — write-tool executors.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §1, §2.11 invariant I-2.
 *         stelavox_technical_architecture_v1_9.md §8.3 write tools, H-08.
 *
 * Write tools NEVER execute database writes inside the agentic loop (H-08).
 * They produce a proposal artefact that the iteration runner extracts
 * and the UI renders as an approvable card. Execution happens only after
 * the author approves (via the per-tool RPC: accept_brief,
 * apply_brief_amendment, apply_profile_amendment, cancel_brief).
 *
 * 2026-05-19 Phase 3 of the create_*_step deprecation refactor: the
 * seven create_*_step executors (one per step op_type) were dead code
 * after Phase 2 removed them from the registry — deleted here. The
 * step-validation logic they performed (verifyTargetNode + per-op-type
 * parameter check + lock check) now lives in propose_brief's per-step
 * validation pass (Phase 1, lib/brief/proposalBuilder.ts StepSchema
 * + buildBriefStepDiagnostics in this file).
 *
 * Five write tools remain, each surfaces exactly one card:
 *   - propose_brief                — BriefProposalCard
 *   - propose_profile_amendment    — ProjectProfileAmendmentCard
 *   - cancel_brief                 — BriefCancellationProposalCard
 *   - propose_brief_amendment      — BriefAmendmentCard
 *   - report_capability_limit      — CapabilityLimitCard
 *
 * Each executor:
 *   1. Validates args via lib/director/schemas.ts (already done by the
 *      executor's caller — validateToolCall — but we trust-and-verify).
 *   2. Per-tool: verifies referenced node ids exist + are writable.
 *   3. Returns the artefact field that surfaces the card.
 */

import 'server-only'

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type {
  BriefProposal,
} from '@/lib/brief/types'
import type {
  DirectorSession,
  PerStepError,
  ToolErrorResult,
  WriteToolResult,
} from '@/lib/director/types'

type WriteToolReturn = WriteToolResult | ToolErrorResult

/** Lightweight target-node existence + org/document scope check. */
// 2026-05-18 M-180: FK-verification at propose_brief boundary. Catches
// the cross-turn ID-hallucination failure shape (model "remembers" a
// UUID from a prior turn that's actually a confabulation; the UUID is
// well-formed so the M-177 sentinel-UUID guard doesn't catch it).
// 2026-05-19 Phase 1: refactored to share checkNodesExist with the new
// per-step diagnostics helper. External signature unchanged so
// existing M-180 layer-2 tests still pass.
export async function verifyProposedTargetNodeIds(
  session: DirectorSession,
  ids: string[],
): Promise<{ ok: true } | { ok: false; missingIds: string[] }> {
  if (ids.length === 0) return { ok: true }
  const unique = Array.from(new Set(ids))
  const existingIds = await checkNodesExist(session, unique)
  const missingIds = unique.filter((id) => !existingIds.has(id))
  if (missingIds.length === 0) return { ok: true }
  return { ok: false, missingIds }
}

/** Bulk existence check scoped to the session's org + document. */
async function checkNodesExist(
  session: DirectorSession,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const supabase = createServiceRoleClient()
  const unique = Array.from(new Set(ids))
  const { data } = await supabase
    .from('nodes')
    .select('id')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .in('id', unique)
  return new Set((data ?? []).map((n) => n.id as string))
}

/** Bulk author-lock check for a set of node ids. */
async function checkNodeLocks(
  ids: string[],
): Promise<Map<string, { locked_by_user_id: string; lock_reason: string | null }>> {
  if (ids.length === 0) return new Map()
  const supabase = createServiceRoleClient()
  const unique = Array.from(new Set(ids))
  const { data } = await supabase
    .from('node_author_locks')
    .select('node_id, locked_by_user_id, lock_reason')
    .in('node_id', unique)
  return new Map(
    (data ?? []).map((r) => [
      r.node_id as string,
      {
        locked_by_user_id: r.locked_by_user_id as string,
        lock_reason: r.lock_reason as string | null,
      },
    ]),
  )
}

/**
 * 2026-05-19 Phase 1 — walk a Brief proposal and produce per-step
 * diagnostics for any step with a missing or locked target_node_id.
 * Caller is responsible for surfacing the diagnostics in the tool
 * return; this helper just builds the list.
 *
 * Locks are checked only for nodes that actually exist (no point
 * locking a non-existent id). The two checks are independent — both
 * may report on the same step.
 */
async function buildBriefStepDiagnostics(
  session: DirectorSession,
  proposal: BriefProposal,
): Promise<PerStepError[]> {
  const allTargets: string[] = []
  for (const stage of proposal.stages) {
    if (!stage.workflow) continue
    for (const step of stage.workflow.steps) {
      if (step.target_node_id) allTargets.push(step.target_node_id)
    }
  }
  if (allTargets.length === 0) return []

  const existingIds = await checkNodesExist(session, allTargets)
  const locks = await checkNodeLocks(Array.from(existingIds))

  const errors: PerStepError[] = []
  for (const stage of proposal.stages) {
    if (!stage.workflow) continue
    for (let i = 0; i < stage.workflow.steps.length; i++) {
      const step = stage.workflow.steps[i]
      if (!step.target_node_id) continue
      if (!existingIds.has(step.target_node_id)) {
        errors.push({
          stage_order: stage.order,
          step_index: i,
          error: 'target_node_not_found',
          reason: `target_node_id ${step.target_node_id} does not exist in this document. Re-call find_node_by_name to ground the id in THIS turn's tool result; do not rely on remembered ids from prior turns.`,
          target_node_id: step.target_node_id,
        })
        continue
      }
      const lock = locks.get(step.target_node_id)
      if (lock) {
        errors.push({
          stage_order: stage.order,
          step_index: i,
          error: 'node_locked',
          reason: `Target node is locked${lock.lock_reason ? ` (reason: ${lock.lock_reason})` : ''}. The author must unlock it before this step can run. Surface this in your prose summary and ask whether to skip the step or wait.`,
          target_node_id: step.target_node_id,
        })
      }
    }
  }
  return errors
}

/**
 * 2026-05-19 Phase 1 — map Zod issues from buildBriefProposal failure
 * into per_step_errors (when the path points at a specific step) and
 * a list of other issues (proposal-level errors).
 *
 * Path shape for step-level issues: ['stages', N, 'workflow', 'steps', M, ...rest]
 * — stage index at path[1], step index at path[4]. We pull stage_order
 * from the raw input args (the model-supplied `order` field on the
 * stage) so the diagnostic uses the model's reference frame, not the
 * post-Zod-parse positional one.
 */
function parseZodIssuesToStepErrors(
  args: Record<string, unknown>,
  issues: z.ZodIssue[],
): { stepErrors: PerStepError[]; otherIssues: string[] } {
  const stepErrors: PerStepError[] = []
  const otherIssues: string[] = []
  const stagesArg = (args as { stages?: Array<{ order?: unknown }> }).stages ?? []

  for (const issue of issues) {
    const path = issue.path
    if (
      path.length >= 5 &&
      path[0] === 'stages' &&
      path[2] === 'workflow' &&
      path[3] === 'steps' &&
      typeof path[1] === 'number' &&
      typeof path[4] === 'number'
    ) {
      const stageIndex = path[1]
      const stepIndex = path[4]
      const stageOrderRaw = stagesArg[stageIndex]?.order
      const stageOrder =
        typeof stageOrderRaw === 'number' && stageOrderRaw > 0 ? stageOrderRaw : stageIndex + 1
      stepErrors.push({
        stage_order: stageOrder,
        step_index: stepIndex,
        error: 'invalid_step_shape',
        reason: issue.message,
        path: path.slice(5) as (string | number)[],
      })
    } else {
      otherIssues.push(`${path.join('.')}: ${issue.message}`)
    }
  }
  return { stepErrors, otherIssues }
}

// 2026-05-19 Phase 3 cleanup: the single-target verifyTargetNode helper
// removed. It was used by the seven deleted create_*_step executors.
// Equivalent checks for propose_brief now go through the bulk helpers
// checkNodesExist + checkNodeLocks (above) — both run as one SQL
// query each, walked per-step to build per_step_errors. The other
// remaining write tools (cancel_brief, propose_brief_amendment,
// propose_profile_amendment, report_capability_limit) don't take a
// raw target_node_id; their own validators query the relevant rows.

// ---------------------------------------------------------------------------
// HISTORICAL NOTE — create_*_step executors removed 2026-05-19 (Phase 3
// of the create_*_step deprecation refactor):
//
//   execCreateExpandStep, execCreateSynthesiseStep, execCreateRefineStep,
//   execCreateContextStep, execCreateCommentStep,
//   execCreateNodeReorderStep, execCreateRenameStep
//
// All seven were thin wrappers that did verifyTargetNode + parameter
// validation + returned a WorkflowStepProposal. After Phase 2 dropped
// them from the registry, no caller remained — Phase 1 had already
// moved the validation logic into propose_brief's discriminated-union
// StepSchema + buildBriefStepDiagnostics. The executors were dead code.
//
// To exercise the equivalent validation behaviour today, build a
// propose_brief input with the step shape inline and call
// execProposeBrief. Per-op-type parameter rules live in
// lib/brief/proposalBuilder.ts (look for StepSchema). The git history
// preserves the original implementations if you need to reference
// them.
//
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

  // ---- Phase 1: Zod shape + per-op-type parameter validation -----------
  //
  // 2026-05-19 Phase 1 of the create_*_step deprecation refactor.
  // buildBriefProposal now validates each workflow step's parameters
  // against a discriminated-union schema keyed by operation_type. A
  // refine step missing `parameters.instruction`, an expand step with
  // a non-integer `parameters.child_count_target`, etc., are all
  // caught here — with structured Zod paths that map cleanly to
  // (stage_order, step_index, [parameters, fieldname]).
  const { buildBriefProposal } = await import('@/lib/brief/proposalBuilder')
  let proposal: BriefProposal
  try {
    proposal = buildBriefProposal(args)
  } catch (e: unknown) {
    if (e instanceof z.ZodError) {
      const { stepErrors, otherIssues } = parseZodIssuesToStepErrors(args, e.issues)
      return {
        ok: false,
        error: 'invalid_brief_proposal',
        reason:
          otherIssues.length > 0
            ? otherIssues.join('; ')
            : `${stepErrors.length} workflow step(s) failed shape validation; see per_step_errors. Each entry names the (stage_order, step_index, path) where the problem is.`,
        ...(stepErrors.length > 0 ? { per_step_errors: stepErrors } : {}),
      }
    }
    return {
      ok: false,
      error: 'invalid_brief_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }

  // ---- Phase 2: DB existence + author-lock checks per step --------------
  //
  // Replaces the M-180 single-error-code path. Now produces per-step
  // diagnostics so the model sees every problem in one round-trip.
  // Existence errors win over lock errors (you can't lock a node that
  // doesn't exist).
  const stepDiagnostics = await buildBriefStepDiagnostics(session, proposal)
  if (stepDiagnostics.length > 0) {
    return {
      ok: false,
      error: 'invalid_brief_proposal',
      reason: `${stepDiagnostics.length} workflow step(s) failed DB validation; see per_step_errors. Common causes: target_node_id not in this document (re-ground via find_node_by_name); target node is currently locked.`,
      per_step_errors: stepDiagnostics,
    }
  }

  // ---- Phase 3: concurrent-edit warning (soft, non-blocking) ------------
  const proposedTargetNodeIds: string[] = []
  for (const stage of proposal.stages) {
    if (stage.workflow?.steps) {
      for (const step of stage.workflow.steps) {
        if (step.target_node_id) proposedTargetNodeIds.push(step.target_node_id)
      }
    }
  }
  let concurrentEditWarning: unknown = null
  if (proposedTargetNodeIds.length > 0) {
    const { detectConcurrentEditWarning } = await import('@/lib/brief/nodeReservationWarnings')
    concurrentEditWarning = await detectConcurrentEditWarning(
      session.document_id,
      proposedTargetNodeIds,
    )
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
