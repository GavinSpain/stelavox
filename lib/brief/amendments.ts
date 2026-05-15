import 'server-only'

/**
 * V1.x-B.3 — Brief amendments (operation-level).
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §3.
 *
 * Profile-level amendments stay on `lib/profile/applyAmendment.ts`
 * (V1.x-A.1). This module handles Brief-level amendments — changes
 * to an active Brief's goal_text / preferences / pending stages.
 *
 * Five amendment types:
 *   - 'goal_text'              — UPDATE briefs.goal_text
 *   - 'preferences'            — UPDATE briefs.preferences (deep merge)
 *   - 'add_stage'              — INSERT brief_stages (must be > current_stage_id's order)
 *   - 'modify_pending_stage'   — UPDATE brief_stages WHERE status='planned'
 *   - 'remove_pending_stage'   — DELETE brief_stages WHERE status='planned'
 *                                 (refused if it would leave zero pending stages)
 *
 * The propose-only invariant (H-08): the Director's `propose_brief_amendment`
 * write-tool returns a `BriefAmendmentProposalArtefact`; the user
 * approves via UI before `apply_brief_amendment` SECURITY DEFINER RPC fires.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

export type BriefAmendmentType =
  | 'goal_text'
  | 'preferences'
  | 'add_stage'
  | 'modify_pending_stage'
  | 'remove_pending_stage'

export interface BriefAmendmentProposalArtefact {
  brief_id: string
  amendment_type: BriefAmendmentType
  /** Dotted-path or stage UUID for modify/remove; null for goal_text/preferences/add_stage. */
  target_path?: string | null
  /** Diff-before snapshot for UI rendering. */
  before?: Record<string, unknown> | null
  /** Diff-after shape. For add_stage this is the new stage payload; for goal_text it's `{ goal_text: string }`; for preferences it's the partial merge object. */
  after: Record<string, unknown>
  reason: string
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const MAX_GOAL_TEXT = 4096
const MAX_REASON = 1024

export interface ValidationError {
  field: string
  message: string
}

/**
 * Validate the proposal artefact shape pre-insertion. Throws an Error
 * with a structured message on failure. Pure function; no DB.
 */
export function validateBriefAmendmentProposal(input: BriefAmendmentProposalArtefact): void {
  const errors: ValidationError[] = []

  if (!input.brief_id || typeof input.brief_id !== 'string') {
    errors.push({ field: 'brief_id', message: 'required UUID' })
  }
  if (!input.reason || input.reason.trim().length === 0) {
    errors.push({ field: 'reason', message: 'required non-empty string' })
  } else if (input.reason.length > MAX_REASON) {
    errors.push({ field: 'reason', message: `exceeds ${MAX_REASON} char limit` })
  }

  switch (input.amendment_type) {
    case 'goal_text': {
      const newGoal = input.after?.goal_text
      if (typeof newGoal !== 'string') {
        errors.push({ field: 'after.goal_text', message: 'required string' })
      } else if (newGoal.length === 0) {
        errors.push({ field: 'after.goal_text', message: 'cannot be empty' })
      } else if (newGoal.length > MAX_GOAL_TEXT) {
        errors.push({ field: 'after.goal_text', message: `exceeds ${MAX_GOAL_TEXT} char limit` })
      }
      break
    }
    case 'preferences': {
      if (!input.after || typeof input.after !== 'object') {
        errors.push({ field: 'after', message: 'preferences requires JSONB object' })
      }
      // Deeper preferences shape validation defers to the M-097
      // preferences validator (H-18 mitigation) which the existing
      // proposalBuilder already invokes for full Briefs.
      break
    }
    case 'add_stage': {
      const order = input.after?.order
      const title = input.after?.title
      if (typeof order !== 'number' || order < 1) {
        errors.push({ field: 'after.order', message: 'required positive integer' })
      }
      if (typeof title !== 'string' || title.length === 0) {
        errors.push({ field: 'after.title', message: 'required non-empty string' })
      }
      const trigger = input.after?.trigger_type
      if (trigger !== undefined && !['after_stage', 'scheduled_at', 'manual', 'compound'].includes(String(trigger))) {
        errors.push({ field: 'after.trigger_type', message: 'must be one of after_stage|scheduled_at|manual|compound' })
      }
      break
    }
    case 'modify_pending_stage':
    case 'remove_pending_stage': {
      if (!input.target_path) {
        errors.push({ field: 'target_path', message: `${input.amendment_type} requires target_path (stage id)` })
      }
      break
    }
    default: {
      const exhaustive: never = input.amendment_type
      void exhaustive
      errors.push({ field: 'amendment_type', message: `unknown amendment_type: ${String(input.amendment_type)}` })
    }
  }

  if (errors.length > 0) {
    throw new Error(`invalid_brief_amendment_proposal: ${errors.map((e) => `${e.field}: ${e.message}`).join('; ')}`)
  }
}

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

export interface InsertProposalInput {
  artefact: BriefAmendmentProposalArtefact
  proposedByUserId: string
}

export interface InsertProposalResult {
  amendmentId: string
}

/**
 * INSERT a proposed amendment row at status='proposed'. Used by the
 * Director write-tool path AND by direct user-driven amendment UI.
 */
export async function insertBriefAmendmentProposal(
  input: InsertProposalInput,
): Promise<InsertProposalResult> {
  validateBriefAmendmentProposal(input.artefact)
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('brief_amendments')
    .insert({
      brief_id: input.artefact.brief_id,
      proposed_by_user_id: input.proposedByUserId,
      amendment_type: input.artefact.amendment_type,
      target_path: input.artefact.target_path ?? null,
      before: (input.artefact.before ?? null) as unknown as Record<string, unknown> | null,
      after: input.artefact.after as unknown as Record<string, unknown>,
      reason: input.artefact.reason,
      status: 'proposed',
    })
    .select('id')
    .single()
  if (error || !data) {
    throw new Error(`insertBriefAmendmentProposal failed: ${error?.message ?? 'no row returned'}`)
  }
  return { amendmentId: data.id }
}

/**
 * Approve a proposed amendment. Sets status='approved' + approved_at
 * + approved_by_user_id; the caller then invokes apply via the RPC.
 */
export async function approveBriefAmendment(
  amendmentId: string,
  approvedByUserId: string,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('brief_amendments')
    .update({
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by_user_id: approvedByUserId,
    })
    .eq('id', amendmentId)
    .eq('status', 'proposed')
  if (error) throw new Error(`approveBriefAmendment failed: ${error.message}`)
}

export async function rejectBriefAmendment(
  amendmentId: string,
  approvedByUserId: string,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('brief_amendments')
    .update({
      status: 'rejected',
      approved_at: new Date().toISOString(),
      approved_by_user_id: approvedByUserId,
    })
    .eq('id', amendmentId)
    .eq('status', 'proposed')
  if (error) throw new Error(`rejectBriefAmendment failed: ${error.message}`)
}

/**
 * Apply an approved amendment via the SECURITY DEFINER RPC (M-128).
 * Returns the post-apply Brief + stages snapshot.
 */
export async function applyBriefAmendmentRpc(amendmentId: string): Promise<Record<string, unknown>> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('apply_brief_amendment', {
    p_amendment_id: amendmentId,
  })
  if (error) {
    throw new Error(`apply_brief_amendment RPC failed: ${error.message}`)
  }
  return data as Record<string, unknown>
}
