/**
 * Director — Zod schemas.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.5, §2.12-2.16, §3.
 * Build Checklist: T-1.5.
 *
 * Every Phase 5b request body, response shape, and tool input has a Zod
 * schema here. The agentic loop's parser uses these schemas to reject
 * malformed proposals (TC-D-02, TC-D-03, TC-D-05).
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()
const positiveIntSchema = z.number().int().positive()
const nonNegativeIntSchema = z.number().int().nonnegative()

// ---------------------------------------------------------------------------
// Request bodies
// ---------------------------------------------------------------------------

/** POST /api/director/message body. */
export const MessageRequestSchema = z.object({
  document_id: uuidSchema,
  conversation_id: uuidSchema.optional(),
  content: z.string().trim().min(1).max(10_000),
  mentioned_node_ids: z.array(uuidSchema).max(50).optional().default([]),
})

export type MessageRequest = z.infer<typeof MessageRequestSchema>

/** POST /api/director/conversation/[id]/messages body (admin). */
export const ConversationMessageAppendSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(50_000),
  tool_calls: z.array(z.record(z.string(), z.unknown())).optional().default([]),
})

export type ConversationMessageAppend = z.infer<typeof ConversationMessageAppendSchema>

/** POST /api/director/workflows/[id]/approve body. */
export const ApproveRequestSchema = z.object({
  approved_step_orders: z.array(positiveIntSchema).optional(),
  step_parameter_overrides: z
    .record(z.string(), z.record(z.string(), z.unknown()))
    .optional(),
})

export type ApproveRequest = z.infer<typeof ApproveRequestSchema>

/** PATCH /api/director/workflows/[id]/steps/[order] body. */
export const StepPatchRequestSchema = z
  .object({
    status: z.enum(['removed', 'pending']).optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    description: z.string().max(2_000).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.parameters !== undefined ||
      v.description !== undefined,
    { message: 'patch_requires_at_least_one_field' },
  )

export type StepPatchRequest = z.infer<typeof StepPatchRequestSchema>

// ---------------------------------------------------------------------------
// WorkflowStepProposal — output of write tools, parsed from Director's JSON
// ---------------------------------------------------------------------------

const ProposalCommonSchema = z.object({
  target_node_id: uuidSchema,
  description: z.string().min(1).max(2_000),
  estimated_duration_seconds: nonNegativeIntSchema,
  depends_on_step_orders: z.array(positiveIntSchema).optional(),
})

export const ExpandStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('expand'),
  parameters: z.object({
    child_count_target: z.number().int().positive().max(20).optional(),
    parent_layer_target: z.string().optional(),
  }),
})

export const SynthesiseStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('synthesise'),
  parameters: z.object({}).strict(),
})

export const RefineStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('refine'),
  parameters: z.object({
    target_field: z.enum(['summary', 'prose', 'notes', 'metadata']),
    instruction: z.string().min(1).max(2_000),
  }),
})

export const GenerateContextStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('generate_context'),
  parameters: z.object({
    context_type: z.enum([
      'character',
      'location',
      'organisation',
      'theme',
      'plot_thread',
      'world',
    ]),
    seed_content: z.string().max(10_000).optional(),
  }),
})

export const CommentStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('comment'),
  parameters: z.object({
    comment_type: z.enum(['instruction', 'note']),
    content: z.string().min(1).max(5_000),
  }),
})

export const NodeReorderStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('node_reorder'),
  parameters: z.object({
    new_order: positiveIntSchema,
    parent_id: uuidSchema.optional(),
  }),
})

export const NodeRenameStepProposalSchema = ProposalCommonSchema.extend({
  operation_type: z.literal('node_rename'),
  parameters: z.object({
    new_name: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(200)),
  }),
})

export const WorkflowStepProposalSchema = z.discriminatedUnion('operation_type', [
  ExpandStepProposalSchema,
  SynthesiseStepProposalSchema,
  RefineStepProposalSchema,
  GenerateContextStepProposalSchema,
  CommentStepProposalSchema,
  NodeReorderStepProposalSchema,
])

export type WorkflowStepProposalParsed = z.infer<typeof WorkflowStepProposalSchema>

/** The full <workflow_proposal> JSON block emitted by the Director. */
export const WorkflowProposalSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  impact_summary: z.string().max(2_000).optional(),
  estimated_total_minutes: nonNegativeIntSchema.optional(),
  steps: z.array(WorkflowStepProposalSchema).min(1).max(100),
  // Optional locked-node hint surfaced by the Director — server re-validates
  // against the live nodes.locked column at execution time anyway (I-6).
  locked_nodes_requiring_unlock: z.array(uuidSchema).optional().default([]),
})

export type WorkflowProposalParsed = z.infer<typeof WorkflowProposalSchema>

// V1.x-A — Brief proposal artefacts emitted in <brief_proposal> and
// <brief_amendment_proposal> content blocks. Loose-shape schemas here
// (the structural validation — cycle detection, dangling refs, value
// shapes per amendment_type — lives in lib/brief/proposalBuilder.ts and
// runs at tool-call time, so by the time a parsed block reaches end-of-
// turn the contents are already validated).
export const BriefProposalSchema = z.object({
  goal_text: z.string().min(1).max(5_000),
  preferences: z.record(z.string(), z.unknown()),
  stages: z
    .array(
      z.object({
        order: positiveIntSchema,
        title: z.string().min(1).max(200),
        description: z.string().max(2_000).optional(),
        // 2026-05-21 simplification (M-183): trigger_type narrowed.
        trigger_type: z.enum(['after_stage', 'manual']),
        trigger_config: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1)
    .max(20),
})
export type BriefProposalParsed = z.infer<typeof BriefProposalSchema>

// V1.x-A.1: BriefAmendmentProposal renamed to ProfileAmendmentProposal.
// The shape is structurally the same — both validate JSONB preference
// edits — but the artefact applies to project_profiles, not briefs.
export const ProfileAmendmentProposalSchema = z.object({
  amendment_type: z.enum([
    'update_goal_text',
    'update_voice',
    'add_constraint',
    'update_constraints',
    'add_decision',
    'update_decisions',
    'update_named_entities',
    'generic_preferences_set',
  ]),
  target_path: z.string().max(200).optional(),
  after: z.unknown(),
  reason: z.string().min(1).max(2_000),
})
export type ProfileAmendmentProposalParsed = z.infer<typeof ProfileAmendmentProposalSchema>

// V1.x-B.1.1: BriefCancellationProposal — destructive write tool.
// Per H-08 the Director never executes; it proposes. The user approves
// via BriefCancellationProposalCard before the cancel_brief RPC runs.
export const BriefCancellationProposalSchema = z.object({
  brief_id: uuidSchema,
  reason: z.string().min(1).max(2_000),
})
export type BriefCancellationProposalParsed = z.infer<typeof BriefCancellationProposalSchema>

// V1.x-A.1: BriefProposal shape is now operation-level. Stage 1's workflow
// is required; stages 2..N may have workflow:null (just-in-time planning).
const _ProposalWorkflowStepSchema = z.object({
  operation_type: z.enum(['expand', 'synthesise', 'refine', 'generate_context', 'comment', 'node_reorder', 'node_rename']),
  target_node_id: z.string().uuid(),
  description: z.string().min(1).max(2_000),
  estimated_duration_seconds: z.number().int().nonnegative(),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  depends_on_step_orders: z.array(z.number().int().positive()).optional(),
})

const _ProposalWorkflowSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  impact_summary: z.string().max(2_000).optional(),
  estimated_total_minutes: z.number().int().nonnegative().optional(),
  steps: z.array(_ProposalWorkflowStepSchema).min(1).max(30),
})

// V1.x post-simplification (M-183/M-184): each stage has EITHER a
// workflow (targets known at brief-proposal time) OR a prompt (targets
// known only after earlier stages complete). The refine() enforces
// exactly-one-of, matching the DB-level
// brief_stages_planning_source_check constraint.
//
// trigger_type narrowed to ('after_stage', 'manual'). scheduled_at +
// compound dropped per M-183. trigger_config kept open so scheduled_at
// can land post-V1 without a schema change.
//
// 2026-05-22 — round-trip drift fix. proposalBuilder.ts writes each
// stage with BOTH workflow and prompt keys, setting the unused one to
// null. The original schema used .optional() (accepts undefined-only)
// so a built artefact round-tripped through safeParse FAILED:
//   - briefProposal parser (parse-message-proposals.ts:161) → no card
//   - iteration-runner brief_proposal yield path (line ~782) → no SSE
// Both consumers silently dropped a perfectly-good propose_brief.
// User test 2026-05-22 surfaced it. Fix: nullable() + truthy XOR.
const _ProposalStageSchema = z
  .object({
    order: positiveIntSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(2_000).optional(),
    trigger_type: z.enum(['after_stage', 'manual']),
    trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
    workflow: _ProposalWorkflowSchema.nullable().optional(),
    prompt: z.string().min(1).max(2_000).nullable().optional(),
  })
  .refine(
    // Truthy XOR — null OR undefined both count as "not set".
    (s) => Boolean(s.workflow) !== Boolean(s.prompt),
    {
      message: 'each stage must have exactly one of workflow or prompt (not both, not neither)',
      path: ['workflow'],
    },
  )

// Operation-level Brief proposal — replaces v2.0's project-level Brief
// proposal schema.
export const BriefProposalV1xA1Schema = z.object({
  goal_text: z.string().min(1).max(2_000),
  stages: z.array(_ProposalStageSchema).min(1).max(20),
})
export type BriefProposalV1xA1Parsed = z.infer<typeof BriefProposalV1xA1Schema>

// V1.x post-simplification — propose_workflow input schema.
// The Director calls this ONLY when the system has invoked it via a
// stage_trigger_fired event for a prompt-deferred stage. The system
// looks up the unique stage with status='planning' on the active
// brief and attaches the workflow to it. No brief_id or stage_id in
// the input — the active stage is unambiguous (single-active-brief +
// at-most-one-planning-stage invariants).
export const ProposeWorkflowSchema = _ProposalWorkflowSchema
export type ProposeWorkflowParsed = z.infer<typeof ProposeWorkflowSchema>

// ---------------------------------------------------------------------------
// Tool input schemas — one per registered tool. Used by validateToolCall().
// ---------------------------------------------------------------------------

export const ToolInputSchemas = {
  // Read tools (7 + 1 V1.x-A)
  get_project_profile: z.object({}).strict(),
  get_brief_state: z.object({}).strict(),
  get_document_state: z.object({}).strict(),
  get_node: z.object({ node_id: uuidSchema }).strict(),
  get_nodes_by_layer: z
    .object({
      layer_index: nonNegativeIntSchema,
      parent_node_id: uuidSchema.optional(),
    })
    .strict(),
  find_node_by_name: z
    .object({
      query: z.string().min(1).max(200),
      node_type: z.string().min(1).max(50).optional(),
      layer_index: nonNegativeIntSchema.optional(),
    })
    .strict(),
  get_node_tree: z
    .object({
      root_node_id: uuidSchema,
      max_depth: z.number().int().positive().max(10).optional(),
    })
    .strict(),
  get_subtree_content: z
    .object({
      root_node_id: uuidSchema,
      max_nodes: z.number().int().positive().max(200).optional(),
      include_prose: z.boolean().optional(),
      include_summary: z.boolean().optional(),
      layer_index: nonNegativeIntSchema.optional(),
    })
    .strict(),
  find_context_references: z
    .object({
      context_node_id: uuidSchema,
      max_results: z.number().int().positive().max(200).optional(),
    })
    .strict(),
  get_subtree_stats: z
    .object({
      root_node_id: uuidSchema,
      max_depth: z.number().int().min(0).max(10).optional(),
    })
    .strict(),
  assess_downstream_impact: z
    .object({
      node_id: uuidSchema,
      change_description: z.string().min(1).max(2_000),
    })
    .strict(),
  get_conversation_history: z
    .object({
      before_sequence: positiveIntSchema.optional(),
      limit: z.number().int().positive().max(50).optional(),
    })
    .strict(),
  get_workflow_history: z
    .object({
      status_filter: z
        .enum([
          'draft',
          'approved',
          'running',
          'paused',
          'completed',
          'cancelled',
        ])
        .optional(),
      limit: z.number().int().positive().max(20).optional(),
    })
    .strict(),

  // Write tools — input is the proposal-construction parameters.
  // 2026-05-19 Phase 3 of the create_*_step deprecation refactor:
  // the 7 create_*_step input-schemas removed. Per-op-type parameter
  // validation now lives in lib/brief/proposalBuilder.ts (look for
  // StepSchema's discriminated-union variants) — those schemas
  // mirror the parameter shapes the create_*_step input-schemas
  // used to enforce. Git history preserves the originals.
  //
  // V1.x-A Brief write-proposal tools. Validators in
  // lib/brief/proposalBuilder.ts perform additional structural checks
  // (cycle detection, dangling refs, value-shape per amendment_type).
  // V1.x-A.1: operation-level Brief. Stage 1's workflow is required;
  // stages 2..N may have workflow:null (just-in-time planning).
  propose_brief: BriefProposalV1xA1Schema.strict(),
  // V1.x-A.1: Profile amendment (was propose_brief_amendment in V1.x-A).
  propose_profile_amendment: ProfileAmendmentProposalSchema.strict(),
  // V1.x-B.1.1: cancel_brief — destructive proposal-only.
  cancel_brief: BriefCancellationProposalSchema.strict(),
  // 2026-05-21 simplification (M-183/M-184): propose_brief_amendment
  // dropped. Replaced by propose_workflow — emitted by the Director
  // when the system invokes it via a stage_trigger_fired event for a
  // prompt-deferred stage. The system attaches the resulting workflow
  // to the unique 'planning' stage on the active brief.
  propose_workflow: ProposeWorkflowSchema,
  // V1.x-F.1: report_capability_limit — synthetic propose-only tool the
  // Director invokes when it detects the user's request exceeds its
  // capability boundaries (per-iteration cap, token budget, tool count,
  // multi-step protocol overflow).
  report_capability_limit: z
    .object({
      detected_limit: z.enum(['per_iteration_cap', 'token_budget', 'tool_count', 'other']),
      suggested_alternative: z.string().min(1).max(2048),
      reason: z.string().min(1).max(2048),
    })
    .strict(),
} as const

export type ToolName = keyof typeof ToolInputSchemas

export const READ_TOOL_NAMES: readonly ToolName[] = [
  'get_project_profile',
  'get_brief_state',
  'get_document_state',
  'get_node',
  'get_nodes_by_layer',
  'get_node_tree',
  'assess_downstream_impact',
  'get_conversation_history',
  'get_workflow_history',
] as const

// Phase 2 (2026-05-19): create_*_step removed from the LLM-facing write
// surface. Workflow steps embed directly inside propose_brief's
// workflow.steps array; propose_brief validates per-op-type parameters
// + target_node existence + author-lock state at the proposal
// boundary, with per_step_errors diagnostics on failure.
// The ToolInputSchemas entries for create_* remain because the
// individual executor helpers still use them (and existing tests
// reference them); they're just not visible to the LLM via
// WRITE_TOOL_NAMES or the tool registry.
export const WRITE_TOOL_NAMES: readonly ToolName[] = [
  'propose_brief',
  'propose_profile_amendment',
  'cancel_brief',
  'propose_workflow',
  'report_capability_limit',
] as const

export function isReadTool(name: string): name is ToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name)
}

export function isWriteTool(name: string): name is ToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}
