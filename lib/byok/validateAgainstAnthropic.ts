import 'server-only'

/**
 * V1.x-B.1.2 — Add-time BYOK key validation.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.3 + locked design
 *         decision #2 at V1.x-B.1.2 kickoff.
 *
 * Tiny completion call to Anthropic Messages API with the key the user
 * just submitted. `model.byok_key_validation` is `claude-haiku-4-5-...`
 * (M-027 seeded; cheap; ~$0.0001 per call). max_tokens=1 keeps it
 * minimal. We don't care about the response content — just the HTTP
 * status code.
 *
 * Three branches:
 *   - 200 OK → valid: true
 *   - 401 / 403 → valid: false, reason "key_rejected"
 *   - other 4xx / 5xx → valid: false, reason from Anthropic body
 *   - network error → throws ValidationInfraError so caller can
 *     distinguish "key bad" from "validation infrastructure broken"
 */

import { getConfigString } from '@/lib/config/platform-config'
import type { ValidationResult } from './types'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

export class ValidationInfraError extends Error {
  constructor(message: string, public cause?: Error) {
    super(message)
    this.name = 'ValidationInfraError'
  }
}

export async function validateAnthropicKey(key: string): Promise<ValidationResult> {
  if (typeof key !== 'string' || key.length < 8) {
    return { valid: false, reason: 'key_too_short' }
  }

  const modelId = await getConfigString('model.byok_key_validation')

  let response: Response
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
  } catch (e) {
    throw new ValidationInfraError(
      `Could not reach Anthropic for key validation: ${(e as Error).message}`,
      e as Error,
    )
  }

  if (response.ok) {
    // Drain the body so we don't leak the connection.
    try { await response.text() } catch { /* ignore */ }
    return { valid: true }
  }

  if (response.status === 401 || response.status === 403) {
    try { await response.text() } catch { /* ignore */ }
    return { valid: false, reason: 'key_rejected', status: response.status }
  }

  // Other error — surface a sanitised reason.
  let reason: string
  try {
    const body = await response.json() as { error?: { message?: string } }
    reason = body.error?.message ?? `anthropic_${response.status}`
  } catch {
    reason = `anthropic_${response.status}`
  }
  return { valid: false, reason, status: response.status }
}
