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
  BriefProposalStepInput,
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

/**
 * 2026-05-20 — bulk fetch of (parent_id, order) for canonical-position
 * lookup. Used by sortWorkflowStepsByCanonicalPosition to give the
 * Director's emitted workflow steps a deterministic, predictable order
 * regardless of what array order the model produced.
 *
 * Scope: same org + document as the session, mirroring checkNodesExist.
 * Returns a Map keyed by node id. Nodes not in the result (e.g. invalid
 * ids) are absent from the map — callers must guard the lookup.
 *
 * `order` is a SQL reserved word; we quote it via the alias 'order_index'
 * to avoid surprises.
 */
async function fetchNodeCanonicalPositions(
  session: DirectorSession,
  ids: string[],
): Promise<Map<string, { parent_id: string | null; order_index: number }>> {
  if (ids.length === 0) return new Map()
  const supabase = createServiceRoleClient()
  const unique = Array.from(new Set(ids))
  const { data } = await supabase
    .from('nodes')
    .select('id, parent_id, order')
    .eq('organisation_id', session.organisation_id)
    .eq('document_id', session.document_id)
    .in('id', unique)
  const result = new Map<string, { parent_id: string | null; order_index: number }>()
  for (const row of data ?? []) {
    result.set(row.id as string, {
      parent_id: (row as { parent_id: string | null }).parent_id,
      order_index: (row as { order: number }).order,
    })
  }
  return result
}

/**
 * 2026-05-20 — canonical-order discipline (Issue 1 fix).
 *
 * Background: the Director system prompt's "Canonical range discipline"
 * section tells the model to plan a contiguous canonical range, but did
 * not explicitly say the steps must be EMITTED in canonical order within
 * the workflow.steps array. The workflow executor runs steps strictly in
 * array order (persistDraftWorkflow assigns `order = i + 1`). A user-driven
 * test on 2026-05-20 hit the failure: 4 expand steps targeting siblings
 * landed in canonical positions 2, 4, 1, 3 — work executed out of
 * narrative order.
 *
 * This sort is the predictability backstop. The Director system prompt
 * (Director config v1.23) also teaches the discipline; the server-side
 * sort ensures the right outcome even if the model fails to follow it.
 *
 * Discipline:
 *   1. Group consecutive same-op_type steps into "runs". Cross-run order
 *      (e.g., generate_context first, then expand) is preserved because
 *      it usually encodes the model's setup-then-act sequencing.
 *   2. Within each run, sort by (parent_id, order_index). Siblings of
 *      the same parent get canonical sibling order; cross-parent
 *      fallback is lexicographic parent UUID for determinism.
 *   3. Skip the sort entirely if any step has explicit
 *      `depends_on_step_orders` — the model declared a dependency graph
 *      and presumably had considered ordering. Respect intent.
 *
 * Nodes missing from `positions` (shouldn't happen post-Phase-2 since
 * existence is validated) are kept in their original relative order
 * within their run.
 */
function sortWorkflowStepsByCanonicalPosition(
  steps: BriefProposalStepInput[],
  positions: Map<string, { parent_id: string | null; order_index: number }>,
): BriefProposalStepInput[] {
  if (steps.length <= 1) return steps
  const hasExplicitDeps = steps.some(
    (s) => (s.depends_on_step_orders ?? []).length > 0,
  )
  if (hasExplicitDeps) return steps

  const result: BriefProposalStepInput[] = []
  let i = 0
  while (i < steps.length) {
    const opType = steps[i].operation_type
    let j = i
    while (j < steps.length && steps[j].operation_type === opType) j++
    const run = steps.slice(i, j)
    const sortedRun = [...run].sort((a, b) => {
      const ap = positions.get(a.target_node_id)
      const bp = positions.get(b.target_node_id)
      if (!ap || !bp) return 0
      const pa = ap.parent_id ?? ''
      const pb = bp.parent_id ?? ''
      if (pa !== pb) return pa < pb ? -1 : 1
      return ap.order_index - bp.order_index
    })
    result.push(...sortedRun)
    i = j
  }
  return result
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

  // ---- Phase 2b: canonical-order normalisation (Issue 1 fix, 2026-05-20)
  //
  // After per-step DB validation but before artefact emission, sort each
  // stage's workflow.steps so that contiguous same-op_type runs are in
  // canonical position order. The Director prompt also teaches this
  // discipline (Director config v1.23+), but the server-side sort is the
  // predictability backstop so a sloppy model emission still runs in the
  // right order.
  //
  // No-op when the model declared explicit depends_on_step_orders on
  // any step in the stage — see sortWorkflowStepsByCanonicalPosition
  // header for the rationale.
  //
  // Positions are fetched in one query covering all target node ids
  // across all stages (existence is already guaranteed post-Phase-2).
  const allTargetIdsForSort: string[] = []
  for (const stage of proposal.stages) {
    if (!stage.workflow) continue
    for (const step of stage.workflow.steps) {
      if (step.target_node_id) allTargetIdsForSort.push(step.target_node_id)
    }
  }
  if (allTargetIdsForSort.length > 0) {
    const positions = await fetchNodeCanonicalPositions(session, allTargetIdsForSort)
    for (const stage of proposal.stages) {
      if (!stage.workflow) continue
      const beforeIds = stage.workflow.steps.map((s) => s.target_node_id)
      const sortedSteps = sortWorkflowStepsByCanonicalPosition(
        stage.workflow.steps,
        positions,
      )
      const reordered = sortedSteps.some(
        (s, idx) => s.target_node_id !== beforeIds[idx],
      )
      if (reordered) {
        // Surface in the dev log so authors / operators see when the
        // model emitted an out-of-canonical sequence the server had to
        // correct. Telemetry only — never blocks; the user sees the
        // corrected order on the PlanCard.
        console.warn(
          '[propose_brief] sort: corrected stage',
          stage.order,
          'workflow step order',
          { before: beforeIds, after: sortedSteps.map((s) => s.target_node_id) },
        )
      }
      stage.workflow.steps = sortedSteps
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
// propose_workflow (2026-05-21 simplification) — emit a workflow proposal
// for a prompt-deferred stage whose trigger has fired.
// ---------------------------------------------------------------------------
//
// Per H-08, write tools never execute. This executor validates the
// proposed workflow shape, resolves the unique 'planning' stage on the
// document's active brief, and returns the artefact + planning_stage_id
// for the iteration runner to attach.
//
// The Director's system prompt v1.24 teaches: only call propose_workflow
// when a stage_trigger_fired event has put you in stage-planning mode.
// The active brief has at most one stage in status='planning' at a
// time (the system enforces this via the push-model evaluator). If
// there's no planning stage when this executor runs, the call is
// rejected — the model has confused user-driven planning with
// stage-planning.

export async function execProposeWorkflow(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()

  // Resolve the active brief on this document. The
  // briefs_strict_one_active_per_document_uidx index (M-183) guarantees
  // at most one row matches.
  const { data: activeBrief, error: briefErr } = await supabase
    .from('briefs')
    .select('id, status')
    .eq('document_id', session.document_id)
    .eq('organisation_id', session.organisation_id)
    .eq('status', 'active')
    .maybeSingle()
  if (briefErr) {
    console.error('[propose_workflow] briefs lookup failed', {
      document_id: session.document_id,
      error: briefErr.message,
      code: briefErr.code,
    })
    return {
      ok: false,
      error: 'brief_lookup_failed',
      reason: `Could not load the active brief for this document: ${briefErr.message}. This is a server-side error, not a user-facing input problem.`,
    }
  }
  if (!activeBrief) {
    return {
      ok: false,
      error: 'no_active_brief',
      reason: 'propose_workflow can only be called when the system has invoked you to plan a stage of an active brief (you would have seen a `stage_trigger_fired` system event). There is no active brief on this document. For user-driven planning, call propose_brief instead.',
    }
  }

  // Find the unique brief_stages row in status='planning' on this brief.
  const { data: planningStages } = await supabase
    .from('brief_stages')
    .select('id, "order", title, prompt, status')
    .eq('brief_id', activeBrief.id)
    .eq('status', 'planning')
  const planningRows = (planningStages ?? []) as Array<{
    id: string
    order: number
    title: string
    prompt: string | null
    status: string
  }>
  if (planningRows.length === 0) {
    return {
      ok: false,
      error: 'no_planning_stage',
      reason: 'propose_workflow is reserved for system-invoked stage planning. The active brief has no stage in status="planning" right now. If a user has asked for new work, call propose_brief instead.',
    }
  }
  if (planningRows.length > 1) {
    // Schema invariant violation — the push-model evaluator must never
    // mark two stages as 'planning' simultaneously. Surface loudly.
    console.error('[propose_workflow] multiple planning stages found', {
      brief_id: activeBrief.id,
      stage_ids: planningRows.map((s) => s.id),
    })
    return {
      ok: false,
      error: 'multiple_planning_stages',
      reason: `Brief ${activeBrief.id} has multiple stages in status='planning' simultaneously, which violates the system invariant. This is a server-side bookkeeping error — surface to the user and report.`,
    }
  }
  const planningStage = planningRows[0]

  // The args themselves were already validated against ProposeWorkflowSchema
  // by validateToolCall before reaching this executor. Trust-and-verify: we
  // re-parse here so the executor stays standalone-testable.
  const { ProposeWorkflowSchema } = await import('@/lib/director/schemas')
  const parsed = ProposeWorkflowSchema.safeParse(args)
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid_workflow_proposal',
      reason: `Workflow shape rejected: ${parsed.error.message}. Check each step's operation_type and parameters against the Step shapes in the system prompt.`,
    }
  }

  // Defensive: validate that every step's target_node_id exists in this
  // document. Mirrors the per-step diagnostics that propose_brief does.
  const targetIds = parsed.data.steps
    .map((s) => s.target_node_id)
    .filter((id): id is string => typeof id === 'string')
  if (targetIds.length > 0) {
    const existing = await checkNodesExist(session, targetIds)
    const missing = targetIds.filter((id) => !existing.has(id))
    if (missing.length > 0) {
      return {
        ok: false,
        error: 'invalid_workflow_proposal',
        reason: `The following target_node_ids don't exist in this document: ${missing.join(', ')}. Re-call find_node_by_name THIS turn to ground them.`,
      }
    }
  }

  // Sort each contiguous same-op-type run of steps by canonical
  // (parent_id, order) — same backstop as propose_brief. Workflow
  // executor runs steps in array order; canonical-order discipline
  // is enforced server-side regardless of how the model emitted them.
  if (parsed.data.steps.length > 1) {
    const positions = await fetchNodeCanonicalPositions(session, targetIds)
    const sorted = sortWorkflowStepsByCanonicalPosition(
      parsed.data.steps as unknown as BriefProposalStepInput[],
      positions,
    )
    parsed.data.steps = sorted as unknown as typeof parsed.data.steps
  }

  return {
    ok: true,
    workflow_proposal: {
      brief_id: activeBrief.id,
      stage_id: planningStage.id,
      stage_order: planningStage.order,
      stage_title: planningStage.title,
      workflow: parsed.data as unknown as Record<string, unknown>,
    },
  } as WriteToolReturn
}

// ---------------------------------------------------------------------------
// LEGACY (removed 2026-05-21): execProposeBriefAmendment.
// ---------------------------------------------------------------------------
// The propose_brief_amendment surface and its 5 amendment_types
// (goal_text / preferences / add_stage / modify_pending_stage /
// remove_pending_stage) produced four schema-vs-code drift bugs in 48
// hours of testing. The dominant use case (modify_pending_stage to
// attach a workflow to a stage whose trigger fired) is now handled by
// execProposeWorkflow above — the system manages the brief↔stage
// linkage server-side, the LLM only emits the workflow shape.
//
// The other four amendment types had no live users in V1.x. If a real
// scenario emerges (e.g. mid-flight goal_text edits), it'll come back
// as a fresh, focused tool — not a rebuild of the old surface.
//
// Git history preserves the implementation if anyone needs to
// reference it: `git show HEAD~N:lib/director/tools/write.ts` will
// show the pre-simplification body.

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

// ---------------------------------------------------------------------------
// Test-only re-exports.
//
// Pure helpers that the unit test suite exercises directly. Prefixed
// with __test_ to make it obvious these are NOT part of the public
// surface; production code never imports these names.
// ---------------------------------------------------------------------------
export { sortWorkflowStepsByCanonicalPosition as __test_sortWorkflowStepsByCanonicalPosition }
