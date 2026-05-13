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
// propose_brief (V1.x-A) — initial Brief for an empty project.
// ---------------------------------------------------------------------------

export async function execProposeBrief(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  // Verify the Brief is empty before allowing a propose_brief. If the
  // Brief already has goal_text, the Director should propose an amendment
  // instead. This is a defence-in-depth check — the system prompt also
  // instructs the Director on the rule.
  const supabase = createServiceRoleClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('brief_id, organisation_id')
    .eq('id', session.document_id)
    .maybeSingle()
  if (!doc || doc.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'document_not_found' }
  }
  if (!doc.brief_id) {
    return { ok: false, error: 'brief_not_found' }
  }
  const { data: brief } = await supabase
    .from('briefs')
    .select('goal_text')
    .eq('id', doc.brief_id)
    .maybeSingle()
  if (!brief) return { ok: false, error: 'brief_not_found' }
  if (brief.goal_text !== null) {
    return { ok: false, error: 'brief_already_populated', reason: 'use propose_brief_amendment for delta changes' }
  }

  // Validate the proposed Brief shape (preferences, stages, cycles, refs).
  const { buildBriefProposal } = await import('@/lib/brief/proposalBuilder')
  try {
    const proposal = buildBriefProposal(args)
    return {
      ok: true,
      brief_proposal: {
        goal_text: proposal.goal_text,
        preferences: proposal.preferences as Record<string, unknown>,
        stages: proposal.stages.map((s) => ({
          order: s.order,
          title: s.title,
          description: s.description,
          trigger_type: s.trigger_type,
          trigger_config: s.trigger_config as Record<string, unknown>,
        })),
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: 'invalid_brief_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}

// ---------------------------------------------------------------------------
// propose_brief_amendment (V1.x-A) — delta change to a populated Brief.
// ---------------------------------------------------------------------------

export async function execProposeBriefAmendment(
  args: Record<string, unknown>,
  session: DirectorSession,
): Promise<WriteToolReturn> {
  const supabase = createServiceRoleClient()
  const { data: doc } = await supabase
    .from('documents')
    .select('brief_id, organisation_id')
    .eq('id', session.document_id)
    .maybeSingle()
  if (!doc || doc.organisation_id !== session.organisation_id) {
    return { ok: false, error: 'document_not_found' }
  }
  if (!doc.brief_id) {
    return { ok: false, error: 'brief_not_found' }
  }
  const { data: brief } = await supabase
    .from('briefs')
    .select('goal_text')
    .eq('id', doc.brief_id)
    .maybeSingle()
  if (!brief) return { ok: false, error: 'brief_not_found' }
  if (brief.goal_text === null) {
    return { ok: false, error: 'brief_empty', reason: 'use propose_brief for the initial Brief' }
  }

  const { buildBriefAmendmentProposal } = await import('@/lib/brief/proposalBuilder')
  try {
    const proposal = buildBriefAmendmentProposal(args)
    return {
      ok: true,
      brief_amendment_proposal: {
        amendment_type: proposal.amendment_type,
        target_path: proposal.target_path,
        after: proposal.after,
        reason: proposal.reason,
      },
    }
  } catch (e) {
    return {
      ok: false,
      error: 'invalid_brief_amendment_proposal',
      reason: e instanceof Error ? e.message : String(e),
    }
  }
}
