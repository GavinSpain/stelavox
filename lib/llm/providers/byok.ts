import 'server-only'

/**
 * V1.x-B.1.2 — BYOK provider.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3 + Edge Function
 *         supabase/functions/byok-llm-call/index.ts.
 *
 * Extends AnthropicProvider, replacing the Anthropic SDK client with one
 * that routes through the BYOK Edge Function via:
 *   - baseURL: <SUPABASE_URL>/functions/v1/byok-llm-call
 *   - custom fetch that injects:
 *     - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *     - x-stelavox-user-id: <userId>
 *
 * The Edge Function fetches the user's BYOK key from Vault, replaces
 * the x-api-key header, and forwards the request to Anthropic. The SDK
 * sees the response in the standard Anthropic shape — all the SDK's
 * streaming + tool-use + extended-thinking machinery works transparently.
 *
 * H-09 invariant: the decrypted BYOK key never materialises in this
 * Next.js process. The custom fetch sends Anthropic's request body
 * along; the Edge Function adds the key on the server-to-Anthropic hop.
 */

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from './anthropic'

export interface ByokProviderConfig {
  supabaseUrl: string
  serviceRoleKey: string
  userId: string
}

export class ByokProvider extends AnthropicProvider {
  constructor(config: ByokProviderConfig) {
    // The base class constructor runs `new Anthropic({ apiKey })`. We
    // throw away that client immediately and replace with our BYOK-routed
    // one. Pass a placeholder apiKey to satisfy the SDK's required-arg
    // check (it's never actually used since our custom fetch overrides
    // the auth header anyway).
    super('byok-routed-key-unused')

    const baseURL = `${config.supabaseUrl}/functions/v1/byok-llm-call`

    const customFetch: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers)
      headers.set('Authorization', `Bearer ${config.serviceRoleKey}`)
      headers.set('x-stelavox-user-id', config.userId)
      // Drop the x-api-key header set by the SDK — the Edge Function
      // sets the real BYOK key when it forwards. Leaving the placeholder
      // here would be cosmetic but might confuse the Edge Function.
      headers.delete('x-api-key')
      return fetch(input, { ...init, headers })
    }

    this.client = new Anthropic({
      apiKey: 'byok-routed-key-unused',
      baseURL,
      fetch: customFetch,
    })
  }
}
