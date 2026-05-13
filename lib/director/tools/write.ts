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

  // V1.x-A.1: one active Brief at a time. Block planning-time conflicts
  // with a clear error before the model invests in a proposal.
  const { count: activeBriefCount } = await supabase
    .from('briefs')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', session.document_id)
    .in('status', ['planned', 'active'])
  if ((activeBriefCount ?? 0) > 0) {
    return {
      ok: false,
      error: 'another_brief_active',
      reason: 'V1.x-A.1 enforces one active Brief per document. Cancel the existing Brief before proposing a new one.',
    }
  }

  const { buildBriefProposal } = await import('@/lib/brief/proposalBuilder')
  try {
    const proposal = buildBriefProposal(args)
    return {
      ok: true,
      brief_proposal: {
        goal_text: proposal.goal_text,
        // The legacy WriteToolResult.brief_proposal artefact shape carries
        // preferences (V1.x-A); for V1.x-A.1 the operation Brief has no
        // preferences — they belong to the Profile. Pass an empty object
        // for backwards compatibility with the executor's parsing layer.
        preferences: {},
        stages: proposal.stages.map((s) => ({
          order: s.order,
          title: s.title,
          description: s.description,
          trigger_type: s.trigger_type,
          trigger_config: s.trigger_config as Record<string, unknown>,
          // workflow attached via separate field below in the actual
          // <brief_proposal> JSON the model emits; the WriteToolResult
          // shape only needs to round-trip the structural skeleton.
        })),
      },
      // Store the full validated proposal (including workflows) for the
      // model's tool_result so it can emit the matching <brief_proposal>
      // block. The executor serialises this onto tool_result.content.
      brief_proposal_full: proposal as unknown as Record<string, unknown>,
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
