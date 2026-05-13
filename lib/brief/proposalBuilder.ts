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

const StepSchema = z.object({
  operation_type: z.enum(['expand', 'synthesise', 'refine', 'generate_context', 'comment', 'node_reorder']),
  target_node_id: z.string().uuid(),
  description: z.string().min(1).max(2000),
  estimated_duration_seconds: z.number().int().nonnegative(),
  parameters: z.record(z.string(), z.unknown()).optional().default({}),
  depends_on_step_orders: z.array(z.number().int().positive()).optional(),
})

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
