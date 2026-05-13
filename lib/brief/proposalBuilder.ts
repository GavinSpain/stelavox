/**
 * Brief proposal builders.
 *
 * Pure functions that validate Director-tool input and produce the
 * artefact objects emitted as <brief_proposal> and
 * <brief_amendment_proposal> content blocks. These do NOT write to the
 * database (H-08) — the artefacts sit in conversation_messages content
 * until the user approves them via the API routes.
 */

import { z } from 'zod'
import type {
  BriefProposal,
  BriefAmendmentProposal,
  BriefProposalStageInput,
  BriefAmendmentType,
} from './types'
import { validatePreferences, validateAmendmentValue } from './preferencesValidator'
import { detectStageTriggerCycles } from './cycleDetector'

// ---------------------------------------------------------------------------
// Zod schemas for tool input
// ---------------------------------------------------------------------------

const TriggerTypeSchema = z.enum(['after_stage', 'scheduled_at', 'manual', 'compound'])

const StageInputSchema = z.object({
  order: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  trigger_type: TriggerTypeSchema,
  trigger_config: z.record(z.string(), z.unknown()).optional().default({}),
})

export const ProposeBriefInputSchema = z.object({
  goal_text: z.string().min(1).max(5000),
  preferences: z.record(z.string(), z.unknown()).optional().default({}),
  stages: z.array(StageInputSchema).min(1).max(20),
})

export type ProposeBriefInput = z.infer<typeof ProposeBriefInputSchema>

const AmendmentTypeSchema = z.enum([
  'update_goal_text',
  'update_voice',
  'add_constraint',
  'update_constraints',
  'add_decision',
  'update_decisions',
  'update_named_entities',
  'generic_preferences_set',
])

export const ProposeBriefAmendmentInputSchema = z.object({
  amendment_type: AmendmentTypeSchema,
  target_path: z.string().max(200).optional(),
  after: z.unknown(),
  reason: z.string().min(1).max(2000),
})

export type ProposeBriefAmendmentInput = z.infer<typeof ProposeBriefAmendmentInputSchema>

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/**
 * Validate a propose_brief tool call and produce a BriefProposal
 * artefact. Throws on:
 *   - schema violations (Zod)
 *   - invalid preferences shape (preferencesValidator)
 *   - stage trigger cycles (cycleDetector)
 *   - duplicate stage orders
 *   - after_stage references to non-existent stages
 */
export function buildBriefProposal(input: unknown): BriefProposal {
  const parsed = ProposeBriefInputSchema.parse(input)

  // Preferences shape check.
  const preferences = validatePreferences(parsed.preferences)

  // Stage order uniqueness.
  const orders = new Set<number>()
  for (const s of parsed.stages) {
    if (orders.has(s.order)) {
      throw new Error(`duplicate_stage_order: ${s.order}`)
    }
    orders.add(s.order)
  }

  // after_stage references must point to existing stages.
  for (const s of parsed.stages) {
    if (s.trigger_type === 'after_stage') {
      const targetOrder = (s.trigger_config as Record<string, unknown>)?.after_stage_order
      if (typeof targetOrder !== 'number') {
        throw new Error(`invalid_trigger_config: stage ${s.order} after_stage missing after_stage_order`)
      }
      if (!orders.has(targetOrder)) {
        throw new Error(`dangling_after_stage_ref: stage ${s.order} references non-existent stage ${targetOrder}`)
      }
      if (targetOrder >= s.order) {
        throw new Error(`forward_after_stage_ref: stage ${s.order} references stage ${targetOrder} (must be lower order)`)
      }
    }
  }

  // Cycle detection.
  const stages: BriefProposalStageInput[] = parsed.stages.map((s) => ({
    order: s.order,
    title: s.title,
    description: s.description,
    trigger_type: s.trigger_type,
    trigger_config: s.trigger_config as BriefProposalStageInput['trigger_config'],
  }))
  const cycleCheck = detectStageTriggerCycles(stages)
  if (!cycleCheck.ok) {
    throw new Error(`stage_trigger_cycle: ${cycleCheck.cycle.join(' → ')}`)
  }

  return {
    goal_text: parsed.goal_text,
    preferences,
    stages,
  }
}

/**
 * Validate a propose_brief_amendment tool call and produce a
 * BriefAmendmentProposal artefact. Throws on schema or value-shape
 * violations.
 */
export function buildBriefAmendmentProposal(input: unknown): BriefAmendmentProposal {
  const parsed = ProposeBriefAmendmentInputSchema.parse(input)

  // For non-goal-text amendments, target_path is required.
  if (parsed.amendment_type !== 'update_goal_text' && !parsed.target_path) {
    throw new Error(`target_path_required: amendment_type ${parsed.amendment_type} requires target_path`)
  }

  validateAmendmentValue(parsed.amendment_type, parsed.target_path, parsed.after)

  return {
    amendment_type: parsed.amendment_type as BriefAmendmentType,
    target_path: parsed.target_path,
    after: parsed.after,
    reason: parsed.reason,
  }
}
