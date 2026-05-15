import 'server-only'

/**
 * V1.x-B.1.2 — BYOK provider. Extended in V1.x-C.3 to support per-org
 * routing alongside the legacy per-user path.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3 + Edge Function
 *         supabase/functions/byok-llm-call/index.ts.
 *         V1.x-C.3 retarget: stelavox_v1x_c_build_checklist_v1_0.md §3 C.3.
 *
 * Extends AnthropicProvider, replacing the Anthropic SDK client with one
 * that routes through the BYOK Edge Function via:
 *   - baseURL: <SUPABASE_URL>/functions/v1/byok-llm-call
 *   - custom fetch that injects:
 *     - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *     - x-stelavox-org-id: <orgId>   (V1.x-C.3 — preferred when org has BYOK)
 *       OR
 *       x-stelavox-user-id: <userId> (V1.x-B.1.2 — transition window)
 *
 * The Edge Function fetches the BYOK key from Vault using whichever
 * header was supplied, replaces the x-api-key header, and forwards the
 * request to Anthropic.
 *
 * H-09 invariant: the decrypted BYOK key never materialises in this
 * Next.js process. The custom fetch sends Anthropic's request body
 * along; the Edge Function adds the key on the server-to-Anthropic hop.
 */

import Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider } from './anthropic'

/**
 * V1.x-C.3 — exactly one of `userId` or `orgId` must be set. The
 * resulting header tells the Edge Function which Vault RPC to call.
 */
export type ByokProviderConfig =
  | {
      supabaseUrl: string
      serviceRoleKey: string
      userId: string
      orgId?: never
    }
  | {
      supabaseUrl: string
      serviceRoleKey: string
      orgId: string
      userId?: never
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
      // V1.x-C.3 — send EITHER org or user header. The Edge Function
      // accepts either and routes to the matching Vault RPC.
      if ('orgId' in config && config.orgId) {
        headers.set('x-stelavox-org-id', config.orgId)
      } else if ('userId' in config && config.userId) {
        headers.set('x-stelavox-user-id', config.userId)
      }
      // Drop the x-api-key header set by the SDK — the Edge Function
      // sets the real BYOK key when it forwards.
      headers.delete('x-api-key')

      const response = await fetch(input, { ...init, headers })

      // Pre-flight 404 detection: if the Edge Function URL itself
      // returns 404 (Supabase "Function not found"), throw a
      // self-explaining error.
      if (response.status === 404) {
        const contentType = response.headers.get('content-type') ?? ''
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
