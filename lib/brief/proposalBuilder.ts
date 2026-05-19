/**
 * Brief proposal builder.
 *
 * Validates a propose_brief tool call and produces a BriefProposal
 * artefact for emission as a <brief_proposal> content block. No DB
 * writes (H-08).
 *
 * V1.x-A.1 vs V1.x-A: the Brief is now operation-level. Stage 1's
 * workflow is required at proposal time; stages 2..N have workflow:null
 * (planned just-in-time when their stage activates).
 */

import { z } from 'zod'
import type {
  BriefProposal,
  BriefProposalStageInput,
  BriefProposalWorkflowInput,
  BriefProposalStepInput,
} from './types'
import { detectStageTriggerCycles } from './cycleDetector'

const TriggerTypeSchema = z.enum(['after_stage', 'scheduled_at', 'manual', 'compound'])

// ---------------------------------------------------------------------------
// Per-operation-type parameter schemas.
// ---------------------------------------------------------------------------
//
// 2026-05-19 (Phase 1 of create_*_step deprecation): validation moves
// from the per-step create_*_step input schemas (one Zod schema per
// tool) into a discriminated union here, at the propose_brief boundary.
// The model can no longer "build a step and forget to propose it" —
// because the only path to a card is propose_brief, and propose_brief
// validates every step's parameters strictly.
//
// Each schema mirrors the corresponding create_*_step input schema in
// lib/director/schemas.ts (which is still the LLM's tool input schema
// while create_*_step remains in the registry; Phase 2 removes them).
// Same comment as M-179 applies: keep these in sync until create_*_step
// is fully retired.

const ExpandParamsSchema = z.object({
  child_count_target: z.number().int().positive().max(20).optional(),
}).strict()

const SynthesiseParamsSchema = z.object({}).strict()

const RefineParamsSchema = z.object({
  target_field: z.enum(['summary', 'prose', 'notes', 'metadata']),
  instruction: z.string().min(1).max(2000),
}).strict()

const GenerateContextParamsSchema = z.object({
  context_type: z.enum(['character', 'location', 'organisation', 'theme', 'plot_thread', 'world']),
  seed_content: z.string().max(10_000).optional(),
}).strict()

const CommentParamsSchema = z.object({
  comment_type: z.enum(['instruction', 'question', 'note', 'critique', 'approval']),
  content: z.string().min(1).max(5000),
}).strict()

const NodeReorderParamsSchema = z.object({
  new_order: z.number().int().positive(),
  parent_id: z.string().uuid().optional(),
}).strict()

const NodeRenameParamsSchema = z.object({
  new_name: z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(200)),
}).strict()

// ---------------------------------------------------------------------------
// Step schema as a discriminated union by operation_type.
// ---------------------------------------------------------------------------
//
// Discriminated union (vs the previous open-parameters object) means
// Zod errors carry a precise path like ['parameters', 'instruction'] for
// any invalid parameters value — the model can act on the diagnostic
// without guessing which field is wrong. Adding a new op_type adds one
// variant here + one workflow-executor branch; no new tool needed.

const baseStepFields = {
  target_node_id: z.string().uuid(),
  description: z.string().min(1).max(2000),
  estimated_duration_seconds: z.number().int().nonnegative(),
  depends_on_step_orders: z.array(z.number().int().positive()).optional(),
}

const StepSchema = z.discriminatedUnion('operation_type', [
  z.object({
    ...baseStepFields,
    operation_type: z.literal('expand'),
    parameters: ExpandParamsSchema.optional().default({}),
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('synthesise'),
    parameters: SynthesiseParamsSchema.optional().default({}),
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('refine'),
    parameters: RefineParamsSchema,
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('generate_context'),
    parameters: GenerateContextParamsSchema,
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('comment'),
    parameters: CommentParamsSchema,
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('node_reorder'),
    parameters: NodeReorderParamsSchema,
  }),
  z.object({
    ...baseStepFields,
    operation_type: z.literal('node_rename'),
    parameters: NodeRenameParamsSchema,
  }),
])

const WorkflowSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  impact_summary: z.string().max(2000).optional(),
  estimated_total_minutes: z.number().int().nonnegative().optional(),
  steps: z.array(StepSchema).min(1).max(30),                    // 30 = agent.director_max_workflow_steps
})

const StageInputSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  trigger_type: TriggerTypeSchema,
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
  workflow: WorkflowSchema.nullable(),
})

export const ProposeBriefInputSchema = z.object({
  goal_text: z.string().min(1).max(2000),
  stages: z.array(StageInputSchema).min(1).max(20),
})

export type ProposeBriefInput = z.infer<typeof ProposeBriefInputSchema>

/**
 * Validate a propose_brief tool call and produce a BriefProposal.
 * Throws on:
 *   - Zod schema violations
 *   - Stage 1's workflow is null (required)
 *   - Duplicate stage orders
 *   - after_stage references to non-existent or higher-order stages
 *   - missing after_stage_order in trigger_config
 *   - Stage trigger cycles (H-19)
 */
export function buildBriefProposal(input: unknown): BriefProposal {
  const parsed = ProposeBriefInputSchema.parse(input)

  // Stage 1's workflow is required.
  const firstStage = parsed.stages.find((s) => s.order === 1)
  if (!firstStage) {
    throw new Error('missing_first_stage: stages must include order=1')
  }
  if (firstStage.workflow == null) {
    throw new Error('first_stage_workflow_required: stage 1 must have a fully-specified workflow')
  }

  // Stage order uniqueness.
  const orders = new Set<number>()
  for (const s of parsed.stages) {
    if (orders.has(s.order)) throw new Error(`duplicate_stage_order: ${s.order}`)
    orders.add(s.order)
  }

  // after_stage refs must point to existing stages with lower order.
  for (const s of parsed.stages) {
    if (s.trigger_type === 'after_stage') {
      const targetOrder = (s.trigger_config as Record<string, unknown>)?.after_stage_order
      if (typeof targetOrder !== 'number') {
        throw new Error(`invalid_trigger_config: stage ${s.order} after_stage missing after_stage_order`)
      }
      if (!orders.has(targetOrder)) {
        throw new Error(`dangling_after_stage_ref: stage ${s.order} → stage ${targetOrder}`)
      }
      if (targetOrder >= s.order) {
        throw new Error(`forward_after_stage_ref: stage ${s.order} must reference a lower-order stage, got ${targetOrder}`)
      }
    }
  }

  // Stage 2..N may have null workflow (just-in-time).
  // Stage 1 already verified above.

  const stages: BriefProposalStageInput[] = parsed.stages.map((s) => ({
    order: s.order,
    title: s.title,
    description: s.description,
    trigger_type: s.trigger_type,
    trigger_config: s.trigger_config as BriefProposalStageInput['trigger_config'],
    workflow: s.workflow as BriefProposalWorkflowInput | null,
  }))

  const cycleCheck = detectStageTriggerCycles(stages)
  if (!cycleCheck.ok) {
    throw new Error(`stage_trigger_cycle: ${cycleCheck.cycle.join(' → ')}`)
  }

  return {
    goal_text: parsed.goal_text,
    stages,
  }
}

// Helper export for tests / route validators
export type { BriefProposalStepInput }
