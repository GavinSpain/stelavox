/**
 * Model Governance P1 — GET/POST /api/admin/models
 *
 * GET  → { models, assignments, metering_integrity }
 * POST → { action, ... } dispatches to the registry write helpers.
 *
 * Admin-only (PLATFORM_ADMIN_EMAILS allowlist, same as the other admin
 * routes). Writes are audited in the registry layer; assignment writes are
 * also DB-trigger-guarded so an unpriced model can never be assigned.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { isPlatformAdmin } from '@/lib/admin/isPlatformAdmin'
import {
  addModel,
  addPricing,
  listAssignments,
  listModels,
  setDirectorModel,
  setModelStatus,
  setProfileModel,
  type ModelStatus,
} from '@/lib/admin/models/registry'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  if (!(await isPlatformAdmin(supabase))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const svc = createServiceRoleClient()
  const [models, assignments, metering] = await Promise.all([
    listModels(),
    listAssignments(),
    svc.rpc('audit_metering_integrity'),
  ])
  const mRow = Array.isArray(metering.data) ? metering.data[0] : metering.data
  return NextResponse.json({
    models,
    assignments,
    metering_integrity: {
      unmetered_completed_jobs: Number(mRow?.unmetered_completed_jobs ?? 0),
      unpriced_agent_profiles: Number(mRow?.unpriced_agent_profiles ?? 0),
      unpriced_director_config: Number(mRow?.unpriced_director_config ?? 0),
    },
  })
}

export async function POST(req: NextRequest): Promise<Response> {
  const supabase = await createClient()
  if (!(await isPlatformAdmin(supabase))) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const action = body.action as string
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string) : '')
  const num = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : NaN)
  const numOrNull = (k: string) => (typeof body[k] === 'number' ? (body[k] as number) : null)

  let result: { ok: boolean; error?: string }
  switch (action) {
    case 'add_model':
      result = await addModel({
        model_id: str('model_id'),
        display_name: str('display_name'),
        provider: str('provider') || undefined,
        input_dollars_per_million: num('input_dollars_per_million'),
        output_dollars_per_million: num('output_dollars_per_million'),
        cache_write_dollars_per_million: numOrNull('cache_write_dollars_per_million'),
        cache_read_dollars_per_million: numOrNull('cache_read_dollars_per_million'),
        effective_from: str('effective_from') || undefined,
        note: str('note') || null,
      })
      break
    case 'add_pricing':
      result = await addPricing({
        model_id: str('model_id'),
        input_dollars_per_million: num('input_dollars_per_million'),
        output_dollars_per_million: num('output_dollars_per_million'),
        cache_write_dollars_per_million: numOrNull('cache_write_dollars_per_million'),
        cache_read_dollars_per_million: numOrNull('cache_read_dollars_per_million'),
        effective_from: str('effective_from') || undefined,
        note: str('note') || null,
      })
      break
    case 'set_status':
      result = await setModelStatus(str('model_id'), str('status') as ModelStatus)
      break
    case 'set_profile_model':
      result = await setProfileModel(str('profile_id'), str('model_id'))
      break
    case 'set_director_model':
      result = await setDirectorModel(str('model_id'))
      break
    default:
      return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? 'write_failed' }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
