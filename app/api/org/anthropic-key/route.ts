/**
 * V1.x-C.4 — POST / DELETE / GET /api/org/anthropic-key.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §5 C.3 (substrate landed
 * in C.3; routes light up here at C.4 close-out).
 *
 * Mirrors /api/user/anthropic-key (V1.x-B.1.2) but org-scoped. Auth +
 * admin-role enforcement happens INSIDE the SECURITY DEFINER RPCs
 * (M-137); the route just relays.
 *
 * Each verb takes an `orgId` from the request — POST/DELETE in the body,
 * GET in a query param. The SECURITY DEFINER RPCs handle the
 * membership / role check against auth.uid().
 *
 * H-09 invariant: the key value reaches the route only on POST and is
 * forwarded to the validation helper + RPC immediately. No code path
 * here reads it after.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'
import {
  saveOrgAnthropicKey,
  getOrgKeyStatus,
  deleteOrgKey,
  SaveOrgKeyError,
} from '@/lib/byok'

// ---------------------------------------------------------------------------
// POST — save + validate
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<Response> {
  let key: string
  let orgId: string
  try {
    const body = (await req.json()) as { key?: unknown; org_id?: unknown }
    if (typeof body.key !== 'string' || body.key.length === 0) {
      return apiError(400, 'invalid_body', 'key: string required')
    }
    if (typeof body.org_id !== 'string' || body.org_id.length === 0) {
      return apiError(400, 'invalid_body', 'org_id: UUID string required')
    }
    key = body.key
    orgId = body.org_id
  } catch {
    return apiError(400, 'invalid_body', 'JSON body required')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const outcome = await saveOrgAnthropicKey(supabase, orgId, key)
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
    if (e instanceof SaveOrgKeyError) {
      const code = e.code === 'validation_infra_error' ? 502 : 500
      return apiError(code, e.code, e.message)
    }
    // SECURITY DEFINER RPCs raise SQL errors for insufficient_role /
    // plan_not_byok_eligible / etc. Forward as 403/422 respectively
    // by matching the message text.
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('insufficient_role') || msg.includes('not_a_member')) {
      return apiError(403, 'insufficient_role', msg)
    }
    if (msg.includes('plan_not_byok_eligible')) {
      return apiError(422, 'plan_not_byok_eligible', msg)
    }
    return apiError(500, 'internal_error', msg)
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove the org's key
// ---------------------------------------------------------------------------

export async function DELETE(req: NextRequest): Promise<Response> {
  const orgId = req.nextUrl.searchParams.get('org_id')
  if (!orgId) return apiError(400, 'invalid_body', 'org_id query param required')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const result = await deleteOrgKey(supabase, orgId)
    if (!result.deleted && result.reason && result.reason !== 'no_key_present') {
      return apiError(500, 'delete_failed', result.reason)
    }
    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('insufficient_role')) {
      return apiError(403, 'insufficient_role', msg)
    }
    return apiError(500, 'internal_error', msg)
  }
}

// ---------------------------------------------------------------------------
// GET — status (no key value)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest): Promise<Response> {
  const orgId = req.nextUrl.searchParams.get('org_id')
  if (!orgId) return apiError(400, 'invalid_body', 'org_id query param required')

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  try {
    const status = await getOrgKeyStatus(supabase, orgId)
    return NextResponse.json(status)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('not_a_member')) {
      return apiError(403, 'not_a_member', msg)
    }
    if (msg.includes('org_not_found')) {
      return apiError(404, 'org_not_found', msg)
    }
    return apiError(500, 'internal_error', msg)
  }
}
