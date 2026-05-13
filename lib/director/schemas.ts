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
        trigger_type: z.enum(['after_stage', 'scheduled_at', 'manual', 'compound']),
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

// V1.x-A.1: BriefProposal shape is now operation-level. Stage 1's workflow
// is required; stages 2..N may have workflow:null (just-in-time planning).
const _ProposalWorkflowStepSchema = z.object({
  operation_type: z.enum(['expand', 'synthesise', 'refine', 'generate_context', 'comment', 'node_reorder']),
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

const _ProposalStageSchema = z.object({
  order: positiveIntSchema,
  title: z.string().min(1).max(200),
  description: z.string().max(2_000).optional(),
  trigger_type: z.enum(['after_stage', 'scheduled_at', 'manual', 'compound']),
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  workflow: _ProposalWorkflowSchema.nullable(),
})

// Operation-level Brief proposal — replaces v2.0's project-level Brief
// proposal schema.
export const BriefProposalV1xA1Schema = z.object({
  goal_text: z.string().min(1).max(2_000),
  stages: z.array(_ProposalStageSchema).min(1).max(20),
})
export type BriefProposalV1xA1Parsed = z.infer<typeof BriefProposalV1xA1Schema>

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
  get_node_tree: z
    .object({
      root_node_id: uuidSchema,
      max_depth: z.number().int().positive().max(10).optional(),
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

  // Write tools (6) — input is the proposal-construction parameters; the
  // executor wraps the result as a WorkflowStepProposal
  create_expand_step: z
    .object({
      target_node_id: uuidSchema,
      child_count_target: z.number().int().positive().max(20).optional(),
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),
  create_synthesise_step: z
    .object({
      target_node_id: uuidSchema,
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),
  create_refine_step: z
    .object({
      target_node_id: uuidSchema,
      target_field: z.enum(['summary', 'prose', 'notes', 'metadata']),
      instruction: z.string().min(1).max(2_000),
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),
  create_context_step: z
    .object({
      target_node_id: uuidSchema,
      context_type: z.enum([
        'character',
        'location',
        'organisation',
        'theme',
        'plot_thread',
        'world',
      ]),
      seed_content: z.string().max(10_000).optional(),
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),
  create_comment_step: z
    .object({
      target_node_id: uuidSchema,
      // F-242 (round-3 audit): aligned to the 5-type set the UI exposes.
      // Pre-fix admitted only 'instruction' | 'note' — Director couldn't
      // create question/critique/approval comments via workflow-step.
      // DB CHECK constraint (Migration 046) enforces the same whitelist.
      comment_type: z.enum(['instruction', 'question', 'note', 'critique', 'approval']),
      content: z.string().min(1).max(5_000),
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),
  create_node_reorder_step: z
    .object({
      target_node_id: uuidSchema,
      new_order: positiveIntSchema,
      parent_id: uuidSchema.optional(),
      description: z.string().min(1).max(2_000),
      estimated_duration_seconds: nonNegativeIntSchema,
    })
    .strict(),

  // V1.x-A Brief write-proposal tools (2). Validators in
  // lib/brief/proposalBuilder.ts perform additional structural checks
  // (cycle detection, dangling refs, value-shape per amendment_type).
  // V1.x-A.1: operation-level Brief. Stage 1's workflow is required;
  // stages 2..N may have workflow:null (just-in-time planning).
  propose_brief: BriefProposalV1xA1Schema.strict(),
  // V1.x-A.1: Profile amendment (was propose_brief_amendment in V1.x-A).
  propose_profile_amendment: ProfileAmendmentProposalSchema.strict(),
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

export const WRITE_TOOL_NAMES: readonly ToolName[] = [
  'create_expand_step',
  'create_synthesise_step',
  'create_refine_step',
  'create_context_step',
  'create_comment_step',
  'create_node_reorder_step',
  'propose_brief',
  'propose_profile_amendment',
] as const

export function isReadTool(name: string): name is ToolName {
  return (READ_TOOL_NAMES as readonly string[]).includes(name)
}

export function isWriteTool(name: string): name is ToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name)
}
