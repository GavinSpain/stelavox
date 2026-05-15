// V1.x-B.1.2 — BYOK Edge Function dispatcher.
//
// Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.2 +
//         V1.x-B design session record §9 +
//         H-09 (TA v2.3.3 §5 — BYOK key plaintext only in Edge Function memory).
//
// This Deno Edge Function is the ONLY place where the decrypted
// Anthropic API key materialises. The key is fetched from Vault via
// `get_user_anthropic_key_for_byok_call(user_id)` (M-104 — service-role
// only RPC), used to invoke Anthropic, and discarded when the function
// returns.
//
// Wire shape: the function accepts the standard Anthropic Messages API
// request payload AS-IS (no envelope wrapping). The caller (Next.js
// server-side ByokProvider) routes Anthropic SDK calls here by setting
// the SDK's baseURL to this Edge Function. The SDK appends `/v1/messages`
// to the baseURL; the Edge Function accepts any POST path under it.
//
// Required headers:
//   - Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
//   - x-stelavox-user-id: <UUID of the user whose BYOK key to use>
//   - anthropic-version: 2023-06-01 (the SDK sets this)
//   - content-type: application/json
//
// Response: streamed pass-through of the Anthropic response.

// @ts-expect-error -- Deno runtime; Next.js TS resolution doesn't see it.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
// @ts-expect-error -- Deno runtime
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Authenticate the caller — service-role JWT required.
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'unauthenticated' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  // @ts-expect-error -- Deno.env is available at runtime
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  // @ts-expect-error -- Deno.env is available at runtime
  const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    return new Response(JSON.stringify({ error: 'edge_function_misconfigured' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  if (jwt !== supabaseServiceRoleKey) {
    // V1.x-B.1.2: only service-role callers (server-side dispatch from
    // Next.js) are supported. Direct user-JWT calls deferred to future
    // work if needed.
    return new Response(JSON.stringify({ error: 'service_role_required' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
  }

  // V1.x-C.3 — accept EITHER x-stelavox-org-id (preferred) OR
  // x-stelavox-user-id (legacy V1.x-B.1.2 transition window). The
  // factory's Option A precedence picks org over user when both apply,
  // so we never receive both headers in practice; if both are present,
  // org wins (defence-in-depth).
  const orgId = req.headers.get('x-stelavox-org-id') ?? ''
  const userId = req.headers.get('x-stelavox-user-id') ?? ''

  if (!orgId && !userId) {
    return new Response(
      JSON.stringify({ error: 'missing_byok_target_header', message: 'Set x-stelavox-org-id or x-stelavox-user-id.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )
  }

  // Fetch the decrypted key from Vault — pick the matching RPC.
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })

  let keyData: unknown = null
  let keyErr: { message?: string } | null = null
  if (orgId) {
    const r = await supabase.rpc('get_org_anthropic_key_for_byok_call', { p_org_id: orgId })
    keyData = r.data
    keyErr = r.error
  } else {
    const r = await supabase.rpc('get_user_anthropic_key_for_byok_call', { p_user_id: userId })
    keyData = r.data
    keyErr = r.error
  }

  if (keyErr || typeof keyData !== 'string' || keyData.length === 0) {
    return new Response(
      JSON.stringify({ error: orgId ? 'no_byok_key_for_org' : 'no_byok_key_for_user' }),
      { status: 404, headers: { 'content-type': 'application/json' } },
    )
  }

  // Hold the key only in this scoped variable.
  let anthropicKey: string | null = keyData

  // Forward request body to Anthropic — body is the standard
  // /v1/messages payload from the Anthropic SDK.
  const anthropicVersion = req.headers.get('anthropic-version') ?? '2023-06-01'
  const requestBody = await req.text()

  let upstream: Response
  try {
    upstream = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': anthropicVersion,
      },
      body: requestBody,
    })
  } catch (e) {
    anthropicKey = null
    return new Response(
      JSON.stringify({ error: 'upstream_network_error', message: (e as Error).message }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )
  }

  // Drop the key from this function's variable scope before piping the
  // response. The fetch call has already serialised the header; this is
  // belt-and-braces — the function context dies on return regardless.
  anthropicKey = null

  // Pipe the response through verbatim. For streaming (SSE), Anthropic
  // returns `text/event-stream`; for non-streaming, `application/json`.
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
    },
  })
})
