/**
 * V1.x-B.1.2 — BYOK shared types.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3.
 */

export interface UserKeyStatusPresent {
  present: true
  last_four: string
  last_validated_at: string
}

export interface UserKeyStatusAbsent {
  present: false
}

export type UserKeyStatus = UserKeyStatusPresent | UserKeyStatusAbsent

export interface SaveKeyResult {
  present: true
  last_four: string
  last_validated_at: string
}

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string; status?: number }
