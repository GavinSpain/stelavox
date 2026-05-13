/**
 * Project Profile preferences validator (H-18 mitigation).
 *
 * The project_profiles.preferences JSONB column has no enforced schema
 * at the DB layer — every amendment-write path runs through this
 * lightly-typed Zod validator to keep the shape coherent over time.
 *
 * Recognised V1.x-A.1 keys: voice (string), constraints (string[]),
 * decisions (string[]), named_entities (Record<string,string>).
 * Unknown top-level keys pass through unchanged.
 */

import { z } from 'zod'
import type { ProjectProfilePreferences } from './types'

const stringArraySchema = z.array(z.string().min(1).max(1000)).max(200)

export const ProjectProfilePreferencesSchema = z
  .object({
    voice: z.string().min(1).max(2000).optional(),
    constraints: stringArraySchema.optional(),
    decisions: stringArraySchema.optional(),
    named_entities: z.record(z.string().min(1), z.string().min(1).max(500)).optional(),
  })
  .passthrough()

export type ValidatedProjectProfilePreferences = z.infer<typeof ProjectProfilePreferencesSchema>

export function validatePreferences(input: unknown): ProjectProfilePreferences {
  return ProjectProfilePreferencesSchema.parse(input) as ProjectProfilePreferences
}

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
      // Unknown preferences.* key — passthrough for forward-compat.
      return
  }
}
