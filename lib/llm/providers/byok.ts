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

/**
 * Thrown by the BYOK custom fetch when Supabase returns 404 for the
 * Edge Function URL. The most common cause is the user has BYOK keys
 * configured but hasn't run `supabase functions serve byok-llm-call`
 * locally — `supabase start` doesn't auto-serve individual functions.
 *
 * The error is self-explaining so the user sees a clear next step
 * instead of a generic "Function not found" 404.
 */
export class ByokEdgeFunctionUnavailableError extends Error {
  constructor(public edgeFunctionUrl: string) {
    super(
      `BYOK Edge Function unreachable at ${edgeFunctionUrl} (Supabase returned 404). ` +
        `Local dev: run \`supabase functions serve byok-llm-call\` in a separate terminal ` +
        `(supabase start does not auto-serve individual functions). ` +
        `Cloud: ensure the function is deployed via \`supabase functions deploy byok-llm-call\`.`,
    )
    this.name = 'ByokEdgeFunctionUnavailableError'
  }
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

      const response = await fetch(input, { ...init, headers })

      // Pre-flight 404 detection: if the Edge Function URL itself
      // returns 404 (Supabase "Function not found"), throw a
      // self-explaining error instead of letting the SDK surface a
      // confusing "Director - 404 Function not found" to the user.
      // We check status + content-type to avoid false positives — a
      // 404 from Anthropic itself (e.g. unknown model) would have
      // application/json + an error envelope, not Supabase's plain
      // text "Function not found".
      if (response.status === 404) {
        const contentType = response.headers.get('content-type') ?? ''
        // Clone before reading so the SDK can still consume the body
        // if we don't end up throwing.
        const cloned = response.clone()
        const bodyText = await cloned.text().catch(() => '')
        const looksLikeSupabaseFunctionMissing =
          /function.*not.*found/i.test(bodyText) ||
          (!contentType.includes('application/json') && bodyText.length < 200)
        if (looksLikeSupabaseFunctionMissing) {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
          throw new ByokEdgeFunctionUnavailableError(url)
        }
      }

      return response
    }

    this.client = new Anthropic({
      apiKey: 'byok-routed-key-unused',
      baseURL,
      fetch: customFetch,
    })
  }
}
