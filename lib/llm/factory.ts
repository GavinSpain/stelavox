/**
 * LLM provider factory.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.2. Build Checklist T-2.2.
 *         V1.x-B.1.2: per-user BYOK routing landed.
 *         V1.x-C.3: per-org BYOK Option A retarget landed.
 *
 * Per TA §3.1:
 *   "Components and API routes must never call the Anthropic SDK or Vercel
 *    AI SDK directly. All LLM calls go through getProvider()."
 *
 * V1.x-C.3 Option A precedence for the provider:
 *   1. Per-org BYOK — if `organisation.byok_enabled=true` AND the org row
 *      has `byok_api_key_vault_id` set, route via ByokProvider(orgId).
 *   2. Per-user BYOK (transition window) — if a userId is supplied AND
 *      that user has a non-deprecated `user_anthropic_keys` row, route
 *      via ByokProvider(userId). This path will deprecate fully in V2.
 *   3. Platform key — AnthropicProvider with process.env.ANTHROPIC_API_KEY.
 *
 * Existing call sites that don't yet pass a userId fall back through to
 * platform; org BYOK is checked unconditionally when the org row is
 * passed in.
 */

import 'server-only'

import { getConfigString } from '@/lib/config/platform-config'
import { orgHasByokKey } from '@/lib/byok/orgKey'
import { userHasByokKey } from '@/lib/llm/byok'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import { ByokProvider } from '@/lib/llm/providers/byok'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type { LLMProvider } from '@/lib/llm/types'

/** Subset of organisations row needed by the factory. */
export interface ProviderResolutionOrg {
  id: string
  plan?: string | null
  byok_enabled?: boolean | null
  byok_provider?: string | null
  byok_api_key_vault_id?: string | null
  preferred_model_overrides?: Record<string, string> | null
}

/**
 * Get the LLM provider + the resolved model_id for an operation.
 *
 * Resolution order for model_id:
 *   1. organisation.preferred_model_overrides[operationType] if set (V2 work)
 *   2. profileModelId from agent_profiles.model_id
 *
 * Resolution order for provider (V1.x-C.3 Option A):
 *   1. Per-org BYOK if org has it enabled + has a vault key → ByokProvider(orgId)
 *   2. Per-user BYOK if userId provided AND user has a key → ByokProvider(userId)
 *   3. Platform key from env → AnthropicProvider
 *
 * `userId` is optional for backwards compatibility — call sites that
 * don't pass it can still get org BYOK if the org row has it enabled.
 */
export async function getProvider(
  organisation: ProviderResolutionOrg,
  operationType: string,
  profileModelId: string,
  userId?: string,
): Promise<{ provider: LLMProvider; modelId: string; route: 'platform' | 'byok' }> {
  const modelId =
    organisation.preferred_model_overrides?.[operationType] ?? profileModelId

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const supabase = createServiceRoleClient()

  // V1.x-C.3 — Option A precedence layer 1: per-org BYOK.
  // The cheapest signal is on the passed-in org row itself; check it
  // first to skip the DB round-trip when the row hasn't been hydrated
  // with byok columns.
  const orgRowSignalsByok =
    organisation.byok_enabled === true && Boolean(organisation.byok_api_key_vault_id)

  // Defensive re-check via DB when the caller might be passing a stale
  // or partial org snapshot (most callers SELECT a narrow column list
  // for cost-meter purposes and may not include byok_*).
  const orgRouteEligible =
    orgRowSignalsByok || (await orgHasByokKey(supabase, organisation.id))

  if (orgRouteEligible) {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'BYOK provider requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.',
      )
    }
    return {
      provider: new ByokProvider({
        supabaseUrl,
        serviceRoleKey,
        orgId: organisation.id,
      }),
      modelId,
      route: 'byok',
    }
  }

  // V1.x-B.1.2 — Option A precedence layer 2: per-user BYOK (transition
  // window). The `userHasByokKey` helper filters out deprecated rows
  // post-M-138 migration, so this layer fires only when the user still
  // has an active per-user key the org-level migration hasn't absorbed.
  if (userId && (await userHasByokKey(supabase, userId))) {
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error(
        'BYOK provider requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY env vars.',
      )
    }
    return {
      provider: new ByokProvider({
        supabaseUrl,
        serviceRoleKey,
        userId,
      }),
      modelId,
      route: 'byok',
    }
  }

  // Layer 3: platform key.
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY env var not set — refusing to invoke LLM provider.',
    )
  }
  return { provider: new AnthropicProvider(apiKey), modelId, route: 'platform' }
}

/**
 * Resolve a model_id from platform_config for an operation type, with
 * optional profile-level override.
 *
 * Used as the seed-time helper in agent_profiles (Migration 027) and at
 * runtime when an operation skips its agent_profiles row's model_id and
 * wants the platform default instead.
 */
export async function getModelForOperation(
  operationType: string,
  profileModelOverride?: string,
): Promise<string> {
  if (profileModelOverride) return profileModelOverride
  return getConfigString(`model.${operationType}`)
}
