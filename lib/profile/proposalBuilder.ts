/**
 * Project Profile amendment proposal builder.
 *
 * Pure function — validates a propose_profile_amendment tool call and
 * produces a ProfileAmendmentProposal artefact for emission as a
 * <profile_amendment_proposal> content block. No DB writes (H-08).
 */

import { z } from 'zod'
import type { ProfileAmendmentProposal, ProfileAmendmentType } from './types'
import { validateAmendmentValue } from './preferencesValidator'

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

export const ProposeProfileAmendmentInputSchema = z.object({
  amendment_type: AmendmentTypeSchema,
  target_path: z.string().max(200).optional(),
  after: z.unknown(),
  reason: z.string().min(1).max(2000),
})

export type ProposeProfileAmendmentInput = z.infer<typeof ProposeProfileAmendmentInputSchema>

export function buildProfileAmendmentProposal(input: unknown): ProfileAmendmentProposal {
  const parsed = ProposeProfileAmendmentInputSchema.parse(input)

  if (parsed.amendment_type !== 'update_goal_text' && !parsed.target_path) {
    throw new Error(`target_path_required: amendment_type ${parsed.amendment_type} requires target_path`)
  }

  validateAmendmentValue(parsed.amendment_type, parsed.target_path, parsed.after)

  return {
    amendment_type: parsed.amendment_type as ProfileAmendmentType,
    target_path: parsed.target_path,
    after: parsed.after,
    reason: parsed.reason,
  }
}
