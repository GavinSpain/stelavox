/**
 * V1.x-B.1.2 — POST / DELETE / GET /api/user/anthropic-key.
 *
 * Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.4.
 *
 * - POST: validate the key against Anthropic + persist via SECURITY
 *   DEFINER RPC. Returns 200 with status payload on success or 422 with
 *   reason on validation failure.
 * - DELETE: remove the user's key + Vault secret.
 * - GET: status only ({present, last_four?, last_validated_at?}); never
 *   the key itself.
 *
 * H-09 invariant: the key value reaches the route only on POST and is
 * forwarded to the validation helper + RPC immediately. No other code
 * path here reads the key. The key is NOT logged, returned in any
 * response, or persisted outside Vault.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import {
  saveUserAnthropicKey,
  getUserKeyStatus,
  deleteUserKey,
  SaveKeyError,
} from '@/lib/byok'

// ---------------------------------------------------------------------------
// POST — save + validate
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  let key: string
  try {
    const body = (await req.json()) as { key?: unknown }
    if (typeof body.key !== 'string' || body.key.length === 0) {
      return apiError(400, 'invalid_body', 'key: string required')
    }
    key = body.key
  } catch {
    return apiError(400, 'invalid_body', 'JSON body required')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const outcome = await saveUserAnthropicKey(supabase, key)
    if (!outcome.validation.valid) {
      return NextResponse.json(
        {
          error: 'validation_failed',
          reason: outcome.validation.reason,
          status: outcome.validation.status,
        },
        { status: 422 },
      )
    }
    return NextResponse.json(outcome.result)
  } catch (e) {
    if (e instanceof SaveKeyError) {
      const code = e.code === 'validation_infra_error' ? 502 : 500
      return apiError(code, e.code, e.message)
    }
    return apiError(500, 'internal_error', e instanceof Error ? e.message : String(e))
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove the user's key
// ---------------------------------------------------------------------------

export async function DELETE(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const result = await deleteUserKey(supabase)
  if (!result.deleted && result.reason && result.reason !== 'no_key_present') {
    return apiError(500, 'delete_failed', result.reason)
  }
  return NextResponse.json(result)
}

// ---------------------------------------------------------------------------
// GET — status only
// ---------------------------------------------------------------------------

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const status = await getUserKeyStatus(supabase)
  return NextResponse.json(status)
}
