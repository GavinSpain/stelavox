/**
 * LLM provider factory.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.2. Build Checklist T-2.2.
 *         V1.x-B.1.2: per-user BYOK routing landed.
 *
 * Per TA §3.1:
 *   "Components and API routes must never call the Anthropic SDK or Vercel
 *    AI SDK directly. All LLM calls go through getProvider()."
 *
 * V1.x-B.1.2 — when a userId is provided AND that user has a BYOK key on
 * file, returns ByokProvider (routes via supabase/functions/byok-llm-call
 * Edge Function with the user's Vault-encrypted key). Otherwise returns
 * AnthropicProvider with process.env.ANTHROPIC_API_KEY.
 *
 * Existing call sites that don't yet pass a userId fall back to the
 * platform AnthropicProvider — no behaviour change. Director route
 * handlers (`/api/director/message` + `/api/director/conversation/[id]/resume`)
 * pass userId from session in V1.x-B.1.2; agent runner integration is
 * a follow-up (V1.x-B.2 alongside the dispatcher refactor).
 */

import 'server-only'

import { getConfigString } from '@/lib/config/platform-config'
import { isByok, userHasByokKey } from '@/lib/llm/byok'
import { AnthropicProvider } from '@/lib/llm/providers/anthropic'
import { ByokProvider } from '@/lib/llm/providers/byok'
import { createServiceRoleClient } from '@/lib/supabase/service'
import type { LLMProvider } from '@/lib/llm/types'

/** Subset of organisations row needed by the factory. V2 expands. */
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
 *   2. profileModelId from agent_profiles.model_id (Migration 027 seeds
 *      these from platform_config.model.<operation>)
 *
 * Resolution order for provider:
 *   1. V1.x-B.1.2 — if `userId` provided AND user has BYOK key →
 *      ByokProvider (routes via Edge Function).
 *   2. AnthropicProvider with platform key from env.
 *
 * `userId` is optional for backwards compatibility — call sites that
 * don't yet pass it (agent runner background path, etc.) get the
 * platform key. Director route handlers pass it from session.
 */
export async function getProvider(
  organisation: ProviderResolutionOrg,
  operationType: string,
  profileModelId: string,
  userId?: string,
): Promise<{ provider: LLMProvider; modelId: string }> {
  const modelId =
    organisation.preferred_model_overrides?.[operationType] ?? profileModelId

  // V1.x-B.1.2 — per-user BYOK routing.
  if (userId) {
    const supabase = createServiceRoleClient()
    if (await userHasByokKey(supabase, userId)) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
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
      }
    }
  }

  // Per-org BYOK columns remain V2 — see lib/llm/byok.ts isByok().
  // V1.x-B.1.2 doesn't use them; per-user keys are the V1 mechanism.

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
