/**
 * LLM provider factory.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.2. Build Checklist T-2.2.
 *
 * Per TA §3.1:
 *   "Components and API routes must never call the Anthropic SDK or Vercel
 *    AI SDK directly. All LLM calls go through getProvider()."
 *
 * V1 implementation: returns AnthropicProvider always. The BYOK / Vault
 * resolution path (TA §7.2) is V2 — keys aren't surfaced to users in V1
 * outside of the platform-paid tiers, all of which use the same Anthropic
 * key from process.env.ANTHROPIC_API_KEY.
 */

import 'server-only'

import { getConfigString } from '@/lib/config/platform-config'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import type { LLMProvider } from '@/lib/llm/types'

/** Subset of organisations row needed by the factory. V2 expands. */
export interface ProviderResolutionOrg {
  id: string
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
 *   2. profileModelId from agent_profiles.model_id (Migration 027 seeds
 *      these from platform_config.model.<operation>)
 *
 * V1 always returns AnthropicProvider. V2 adds BYOK paths via Vercel AI SDK.
 */
export async function getProvider(
  organisation: ProviderResolutionOrg,
  operationType: string,
  profileModelId: string,
): Promise<{ provider: LLMProvider; modelId: string }> {
  const modelId =
    organisation.preferred_model_overrides?.[operationType] ?? profileModelId

  // V2 BYOK path (deferred — kept here as a structural marker)
  // if (organisation.byok_enabled && organisation.byok_api_key_vault_id) { ... }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error(
      'ANTHROPIC_API_KEY env var not set — refusing to invoke LLM provider.',
    )
  }
  return { provider: new AnthropicProvider(apiKey), modelId }
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
