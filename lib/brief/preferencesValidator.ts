/**
 * Brief preferences validator (H-18 mitigation).
 *
 * The briefs.preferences JSONB column has no enforced schema at the DB
 * layer — over time the Director may generate inconsistent shapes for
 * the same key (e.g. voice as string in one Brief, as object in another).
 * This lightly-typed Zod validator runs at every amendment-write path to
 * keep the shape coherent while still allowing forward-compat extension.
 *
 * Recognised V1.x-A keys: voice (string), constraints (string[]),
 * decisions (string[]), named_entities (Record<string,string>).
 * Unknown top-level keys pass through unchanged.
 */

import { z } from 'zod'
import type { BriefPreferences } from './types'

const stringArraySchema = z.array(z.string().min(1).max(1000)).max(200)

export const BriefPreferencesSchema = z
  .object({
    voice: z.string().min(1).max(2000).optional(),
    constraints: stringArraySchema.optional(),
    decisions: stringArraySchema.optional(),
    named_entities: z.record(z.string().min(1), z.string().min(1).max(500)).optional(),
  })
  .passthrough()

export type ValidatedBriefPreferences = z.infer<typeof BriefPreferencesSchema>

/**
 * Validate a preferences object. Returns the parsed shape on success or
 * throws a ZodError. Callers map errors to HTTP 400 / API error envelopes.
 */
export function validatePreferences(input: unknown): BriefPreferences {
  return BriefPreferencesSchema.parse(input) as BriefPreferences
}

/**
 * Validate a single amendment delta. The `target_path` tells us which
 * sub-shape `after` should match. For preferences.<key>, the value should
 * match the type expected at that key.
 *
 * For unknown target paths under preferences.*, falls back to permissive
 * acceptance (passthrough) — the H-18 strategy is "evolved by additive
 * rules", not strict-mode-by-default.
 */
export function validateAmendmentValue(
  amendmentType: string,
  targetPath: string | undefined,
  after: unknown,
): void {
  if (amendmentType === 'update_goal_text') {
    if (typeof after !== 'string' || after.trim().length === 0 || after.length > 5000) {
      throw new Error('invalid_goal_text: expected non-empty string ≤5000 chars')
    }
    return
  }

  if (!targetPath || !targetPath.startsWith('preferences.')) {
    throw new Error(`invalid_target_path: expected preferences.<key>, got ${targetPath ?? '<undefined>'}`)
  }

  const key = targetPath.slice('preferences.'.length)
  switch (key) {
    case 'voice':
      if (typeof after !== 'string' || after.length > 2000) {
        throw new Error('invalid_voice: expected string ≤2000 chars')
      }
      return
    case 'constraints':
    case 'decisions':
      stringArraySchema.parse(after)
      return
    case 'named_entities':
      z.record(z.string().min(1), z.string().min(1).max(500)).parse(after)
      return
    default:
      // Unknown preferences.* key — permissive passthrough for forward-compat.
      // The DB write will succeed; the admin dashboard (V1.x-E) surfaces
      // unrecognised shapes for review.
      return
  }
}
