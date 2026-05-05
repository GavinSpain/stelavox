/**
 * Zod request-body schemas for Phase 5 agent operation API routes.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.5 (validation rules) +
 *         §3.1 / §3.2 / §3.3 / §3.4 (per-operation validation order).
 * Build Checklist: T-8.
 */

import { z } from 'zod'

const uuid = z.string().uuid()

/** Common base for all four agent operation bodies. */
const baseAgentBody = z.object({
  node_id: uuid,
  profile_id: uuid.optional(),
  agent_instruction: z.string().trim().max(2000).optional(),
  expected_version: z.number().int().min(1).optional(),
})

export const expandBodySchema = baseAgentBody.extend({
  target_layer_count: z.number().int().min(1).max(10).optional(),
}).strict()

export const synthesiseBodySchema = baseAgentBody.extend({
  prose_target_words: z.number().int().min(100).max(50_000).optional(),
}).strict()

export const refineBodySchema = baseAgentBody.extend({
  target_field: z.enum(['summary', 'prose', 'notes']),
  refinement_instruction: z.string().trim().min(1).max(2000),
}).strict()

export const generateContextBodySchema = baseAgentBody.strict()

// ---------------------------------------------------------------------------
// Comment bodies (§3.10, §3.12, §3.13)
// ---------------------------------------------------------------------------

export const COMMENT_TYPES = ['instruction', 'question', 'note', 'critique', 'approval'] as const

export const commentCreateBodySchema = z.object({
  comment_type: z.enum(COMMENT_TYPES),
  content: z.string().trim().min(1).max(4000),
  parent_comment_id: uuid.nullable().optional(),
}).strict()

export const commentPatchBodySchema = z.object({
  content: z.string().trim().min(1).max(4000),
}).strict()

// ---------------------------------------------------------------------------
// Helper exports
// ---------------------------------------------------------------------------

export type ExpandBody = z.infer<typeof expandBodySchema>
export type SynthesiseBody = z.infer<typeof synthesiseBodySchema>
export type RefineBody = z.infer<typeof refineBodySchema>
export type GenerateContextBody = z.infer<typeof generateContextBodySchema>
export type CommentCreateBody = z.infer<typeof commentCreateBodySchema>
export type CommentPatchBody = z.infer<typeof commentPatchBodySchema>
