import 'server-only'

/**
 * V1.x-C.3 — per-org BYOK helpers.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §3 C.3.
 *
 * Mirrors lib/byok/saveUserKey + getUserKeyStatus + deleteUserKey but
 * scoped to an organisation rather than a user. The RPCs live in
 * M-137 and require the caller to be owner/admin of the org; the
 * Next.js API route layer is responsible for passing through an
 * authenticated supabase client.
 *
 * The decrypted key fetch RPC (`get_org_anthropic_key_for_byok_call`)
 * is INTENTIONALLY NOT wrapped in this module — only the BYOK Edge
 * Function is supposed to invoke it, per the H-09 invariant.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateAnthropicKey, ValidationInfraError } from './validateAgainstAnthropic'
import type { ValidationResult } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OrgKeyStatusPresent {
  present: true
  byok_enabled: boolean
  plan: string
  last_four: string
  last_validated_at: string
}

export interface OrgKeyStatusAbsent {
  present: false
  byok_enabled: boolean
  plan: string
  last_four: null
  last_validated_at: null
}

export type OrgKeyStatus = OrgKeyStatusPresent | OrgKeyStatusAbsent

export interface SaveOrgKeyResult {
  present: true
  byok_enabled: true
  last_four: string
  last_validated_at: string
}

export interface SaveOrgKeyOutcome {
  result: SaveOrgKeyResult | null
  validation: ValidationResult
}

export class SaveOrgKeyError extends Error {
  constructor(message: string, public code: string, public cause?: Error) {
    super(message)
    this.name = 'SaveOrgKeyError'
  }
}

// ---------------------------------------------------------------------------
// saveOrgAnthropicKey
// ---------------------------------------------------------------------------

/**
 * Validate the key against Anthropic; on success, persist via the
 * authenticated SECURITY DEFINER RPC `save_org_anthropic_key`. Returns:
 *   - { result: SaveOrgKeyResult, validation: { valid: true } } on success
 *   - { result: null, validation: { valid: false, ... } } on validation failure
 *
 * Throws SaveOrgKeyError on infrastructure failure (network, DB unavailable
 * etc.) or on RPC failure (plan eligibility violation, insufficient role).
 *
 * The supabase client must be authenticated as a user with owner/admin
 * role on the target org — the RPC enforces this.
 */
export async function saveOrgAnthropicKey(
  supabase: SupabaseClient,
  orgId: string,
  key: string,
): Promise<SaveOrgKeyOutcome> {
  let validation: ValidationResult
  try {
    validation = await validateAnthropicKey(key)
  } catch (e) {
    if (e instanceof ValidationInfraError) {
      throw new SaveOrgKeyError(e.message, 'validation_infra_error', e)
    }
    throw e
  }

  if (!validation.valid) {
    return { result: null, validation }
  }

  const validatedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('save_org_anthropic_key', {
    p_org_id: orgId,
    p_key: key,
    p_validation_completed_at: validatedAt,
  })

  if (error) {
    throw new SaveOrgKeyError(
      `save_org_anthropic_key RPC failed: ${error.message}`,
      'rpc_error',
    )
  }

  return {
    result: data as unknown as SaveOrgKeyResult,
    validation,
  }
}

// ---------------------------------------------------------------------------
// getOrgKeyStatus
// ---------------------------------------------------------------------------

export async function getOrgKeyStatus(
  supabase: SupabaseClient,
  orgId: string,
): Promise<OrgKeyStatus> {
  const { data, error } = await supabase.rpc('get_org_anthropic_key_status', {
    p_org_id: orgId,
  })

  if (error) {
    throw new Error(`get_org_anthropic_key_status RPC failed: ${error.message}`)
  }

  return data as unknown as OrgKeyStatus
}

// ---------------------------------------------------------------------------
// deleteOrgKey
// ---------------------------------------------------------------------------

export async function deleteOrgKey(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ deleted: boolean; reason?: string }> {
  const { data, error } = await supabase.rpc('delete_org_anthropic_key', {
    p_org_id: orgId,
  })

  if (error) {
    throw new Error(`delete_org_anthropic_key RPC failed: ${error.message}`)
  }

  return data as unknown as { deleted: boolean; reason?: string }
}

// ---------------------------------------------------------------------------
// orgHasByokKey — service-role helper for the factory's routing
// precedence check.
// ---------------------------------------------------------------------------

/**
 * Returns true iff the org has BYOK enabled AND has a vault_secret_id
 * present on its row. Used by the factory's Option A precedence layer:
 * org BYOK wins over per-user BYOK wins over platform.
 *
 * Reads via service-role since this fires from server-side dispatch
 * paths that may not have a user session (workflow executor, scheduler,
 * iteration runner).
 */
export async function orgHasByokKey(
  supabase: SupabaseClient,
  orgId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('organisations')
    .select('byok_enabled, byok_api_key_vault_id')
    .eq('id', orgId)
    .maybeSingle()

  if (error) {
    console.warn('[lib/byok/orgKey] orgHasByokKey query failed:', error.message)
    return false
  }

  return Boolean(
    data?.byok_enabled === true && data?.byok_api_key_vault_id,
  )
}
