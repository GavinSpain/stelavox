/**
 * Project Profile — shared types.
 *
 * Source: stelavox_director_architecture_v2_1_0.md §6.1 + V1.x-A.1 build
 * checklist §3.3.
 *
 * Types only. Imported by lib/profile/*, lib/director/tools/*, and the
 * Profile API routes.
 */

export type ProfileAmendmentProposedBy = 'user' | 'director'

/**
 * Supported amendment types in V1.x-A.1.
 */
export type ProfileAmendmentType =
  | 'update_goal_text'
  | 'update_voice'
  | 'add_constraint'
  | 'update_constraints'
  | 'add_decision'
  | 'update_decisions'
  | 'update_named_entities'
  | 'generic_preferences_set'

/**
 * Preferences shape held in project_profiles.preferences JSONB. Unknown
 * keys are allowed (forward-compat) but the typed shape covers V1.x-A.1
 * recognised fields. preferencesValidator enforces these at write time
 * per H-18.
 */
export interface ProjectProfilePreferences {
  voice?: string
  constraints?: string[]
  decisions?: string[]
  named_entities?: Record<string, string>
  [k: string]: unknown
}

/** A single project_profiles row. */
export interface ProjectProfile {
  id: string
  document_id: string
  organisation_id: string
  goal_text: string | null
  preferences: ProjectProfilePreferences
  created_at: string
  updated_at: string
}

/** A single profile_amendments row. */
export interface ProfileAmendment {
  id: string
  profile_id: string
  proposed_by: ProfileAmendmentProposedBy
  amendment_type: ProfileAmendmentType | string
  target_path: string | null
  before: unknown
  after: unknown
  approved_at: string
  approved_by_user_id: string | null
  reason: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Director-facing payloads
// ---------------------------------------------------------------------------

/**
 * Flattened response of get_project_profile. Source: V2.1 §6.1.3.
 */
export interface ProjectProfilePayload {
  goal_text: string | null
  preferences: ProjectProfilePreferences
  recent_amendments: Array<
    Pick<ProfileAmendment, 'amendment_type' | 'target_path' | 'reason' | 'approved_at' | 'proposed_by'>
  >
}

// ---------------------------------------------------------------------------
// Proposal artefact (Director write-tool)
// ---------------------------------------------------------------------------

/** Output of propose_profile_amendment — emitted as <profile_amendment_proposal>. */
export interface ProfileAmendmentProposal {
  amendment_type: ProfileAmendmentType
  target_path?: string                                // omitted for update_goal_text
  after: unknown
  reason: string
}
