import 'server-only'

/**
 * V1.x-B.1.2 — Orchestrate save flow: validate → save_user_anthropic_key RPC.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3.
 *
 * Caller is the Next.js POST /api/user/anthropic-key route. Returns the
 * status payload (no key). The decrypted key never reaches Next.js
 * code outside this function's variable scope (the RPC takes the key
 * by value and immediately encrypts to Vault).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { SaveKeyResult, ValidationResult } from './types'
import { validateAnthropicKey, ValidationInfraError } from './validateAgainstAnthropic'

export class SaveKeyError extends Error {
  constructor(message: string, public code: string, public cause?: Error) {
    super(message)
    this.name = 'SaveKeyError'
  }
}

export interface SaveUserKeyOutcome {
  result: SaveKeyResult | null
  validation: ValidationResult
}

/**
 * Validate the key against Anthropic; on success, persist via the
 * authenticated SECURITY DEFINER RPC. Returns:
 *   - { result: SaveKeyResult, validation: { valid: true } } on success
 *   - { result: null, validation: { valid: false, ... } } on validation failure
 * Throws SaveKeyError on infrastructure failure (network, DB unavailable etc.).
 */
export async function saveUserAnthropicKey(
  supabase: SupabaseClient,
  key: string,
): Promise<SaveUserKeyOutcome> {
  let validation: ValidationResult
  try {
    validation = await validateAnthropicKey(key)
  } catch (e) {
    if (e instanceof ValidationInfraError) {
      throw new SaveKeyError(e.message, 'validation_infra_error', e)
    }
    throw e
  }

  if (!validation.valid) {
    return { result: null, validation }
  }

  const validatedAt = new Date().toISOString()
  const { data, error } = await supabase.rpc('save_user_anthropic_key', {
    p_key: key,
    p_validation_completed_at: validatedAt,
  })

  if (error) {
    throw new SaveKeyError(`save_user_anthropic_key RPC failed: ${error.message}`, 'rpc_error')
  }

  return {
    result: data as unknown as SaveKeyResult,
    validation,
  }
}
