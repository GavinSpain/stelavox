import 'server-only'

/**
 * V1.x-E.1 — Anthropic rate-limit header capture.
 *
 * Source: Component Spec §17.5 §3 (Anthropic header headroom) ·
 * wireframe_admin_dashboard_v1.html §05 M-143 + annotation 5.
 *
 * Reads the rate-limit headers Anthropic returns on every API response
 * and inserts a row into anthropic_rate_limit_samples. The admin
 * dashboard reads the most-recent row per model to render the headroom
 * widget.
 *
 * Headers consulted (per Anthropic docs):
 *   anthropic-ratelimit-requests-limit / -remaining / -reset
 *   anthropic-ratelimit-input-tokens-limit / -remaining / -reset
 *   anthropic-ratelimit-output-tokens-limit / -remaining / -reset
 *   anthropic-ratelimit-tokens-tier (optional)
 *
 * Only platform-key calls are captured here; BYOK calls return their
 * USER's rate-limit headers (not the platform's), which would pollute
 * the admin headroom signal. ByokProvider deliberately does not call
 * this hook.
 *
 * Fire-and-forget: the insert is awaited but errors are swallowed —
 * a failed capture should never affect the LLM call's primary path.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

interface RateLimitHeaders {
  requests_limit: number | null
  requests_remaining: number | null
  requests_reset: string | null
  input_tokens_limit: number | null
  input_tokens_remaining: number | null
  input_tokens_reset: string | null
  output_tokens_limit: number | null
  output_tokens_remaining: number | null
  output_tokens_reset: string | null
  tier: string | null
}

function parseInt32(s: string | null): number | null {
  if (!s) return null
  const n = parseInt(s, 10)
  return Number.isFinite(n) ? n : null
}

function parseTimestamp(s: string | null): string | null {
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function readHeaders(headers: Headers): RateLimitHeaders {
  return {
    requests_limit: parseInt32(headers.get('anthropic-ratelimit-requests-limit')),
    requests_remaining: parseInt32(headers.get('anthropic-ratelimit-requests-remaining')),
    requests_reset: parseTimestamp(headers.get('anthropic-ratelimit-requests-reset')),
    input_tokens_limit: parseInt32(headers.get('anthropic-ratelimit-input-tokens-limit')),
    input_tokens_remaining: parseInt32(headers.get('anthropic-ratelimit-input-tokens-remaining')),
    input_tokens_reset: parseTimestamp(headers.get('anthropic-ratelimit-input-tokens-reset')),
    output_tokens_limit: parseInt32(headers.get('anthropic-ratelimit-output-tokens-limit')),
    output_tokens_remaining: parseInt32(headers.get('anthropic-ratelimit-output-tokens-remaining')),
    output_tokens_reset: parseTimestamp(headers.get('anthropic-ratelimit-output-tokens-reset')),
    tier: headers.get('anthropic-ratelimit-tokens-tier'),
  }
}

/**
 * Fire-and-forget capture from a fetch Response. modelId is the model
 * the call was placed against — pulled from the request body or URL
 * by the caller; defaults to 'unknown' if not resolvable.
 */
export async function captureAnthropicHeaders(
  response: Response,
  modelId: string,
): Promise<void> {
  try {
    const parsed = readHeaders(response.headers)
    // If no rate-limit headers at all (unusual — Anthropic returns them
    // on every successful call) skip the insert.
    if (
      parsed.requests_limit === null &&
      parsed.input_tokens_limit === null &&
      parsed.output_tokens_limit === null
    ) {
      return
    }
    const supabase = createServiceRoleClient()
    await supabase.from('anthropic_rate_limit_samples').insert({
      model_id: modelId,
      requests_limit: parsed.requests_limit,
      requests_remaining: parsed.requests_remaining,
      requests_reset: parsed.requests_reset,
      input_tokens_limit: parsed.input_tokens_limit,
      input_tokens_remaining: parsed.input_tokens_remaining,
      input_tokens_reset: parsed.input_tokens_reset,
      output_tokens_limit: parsed.output_tokens_limit,
      output_tokens_remaining: parsed.output_tokens_remaining,
      output_tokens_reset: parsed.output_tokens_reset,
      tier: parsed.tier,
    })
  } catch {
    // Capture is best-effort. A failed insert (network blip, transient
    // DB unavailability) must never affect the LLM call's primary path.
  }
}
