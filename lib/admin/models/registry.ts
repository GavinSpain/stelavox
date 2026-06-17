/**
 * Model Governance P1 — admin model registry read/write service layer.
 *
 * Single place to: list models (with current pricing + assignability), add a
 * model (registry row + initial pricing in one go), re-price (append a new
 * effective-dated pricing row — H-20), change status, and assign models to the
 * live knobs (agent_profiles + the production Director config).
 *
 * Every write goes through the service-role client + writes an audit_log row.
 * Assignment writes are additionally guarded by the DB trigger (M-232), so an
 * unpriced/deprecated model is impossible to assign even if a validator is
 * bypassed — the API just surfaces a clean error first.
 */

import 'server-only'

import { writeAuditLogEntry } from '@/lib/security/audit'
import { createServiceRoleClient } from '@/lib/supabase/service'

export type ModelStatus = 'active' | 'deprecated' | 'hidden'

export interface ModelRow {
  model_id: string
  display_name: string
  provider: string
  status: ModelStatus
  note: string | null
  pricing: {
    input_dollars_per_million: number
    output_dollars_per_million: number
    cache_write_dollars_per_million: number | null
    cache_read_dollars_per_million: number | null
    effective_from: string
  } | null
  assignable: boolean
}

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{2,80}$/
const today = () => new Date().toISOString().slice(0, 10)

function validRate(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 100_000
}

// ---- reads ---------------------------------------------------------------

export async function listModels(): Promise<ModelRow[]> {
  const svc = createServiceRoleClient()
  const [{ data: models }, { data: pricing }] = await Promise.all([
    svc.from('llm_models').select('model_id, display_name, provider, status, note').order('display_name'),
    svc
      .from('anthropic_pricing')
      .select(
        'model_id, effective_from, effective_until, input_dollars_per_million, output_dollars_per_million, cache_write_dollars_per_million, cache_read_dollars_per_million',
      ),
  ])
  const d = today()
  // Latest current pricing row per model.
  const current = new Map<string, NonNullable<ModelRow['pricing']>>()
  for (const p of pricing ?? []) {
    const inWindow = p.effective_from <= d && (p.effective_until === null || p.effective_until > d)
    if (!inWindow) continue
    const prev = current.get(p.model_id)
    if (!prev || p.effective_from > prev.effective_from) {
      current.set(p.model_id, {
        input_dollars_per_million: Number(p.input_dollars_per_million),
        output_dollars_per_million: Number(p.output_dollars_per_million),
        cache_write_dollars_per_million:
          p.cache_write_dollars_per_million === null ? null : Number(p.cache_write_dollars_per_million),
        cache_read_dollars_per_million:
          p.cache_read_dollars_per_million === null ? null : Number(p.cache_read_dollars_per_million),
        effective_from: p.effective_from,
      })
    }
  }
  return (models ?? []).map((m) => {
    const pr = current.get(m.model_id) ?? null
    return {
      model_id: m.model_id,
      display_name: m.display_name,
      provider: m.provider,
      status: m.status as ModelStatus,
      note: m.note,
      pricing: pr,
      assignable: m.status === 'active' && pr !== null,
    }
  })
}

export interface AssignmentsView {
  agent_profiles: Array<{
    id: string
    name: string
    operation_type: string
    node_type: string | null
    model_id: string
  }>
  director: { version_number: number; model_id: string } | null
}

export async function listAssignments(): Promise<AssignmentsView> {
  const svc = createServiceRoleClient()
  const [{ data: profiles }, { data: director }] = await Promise.all([
    svc
      .from('agent_profiles')
      .select('id, name, operation_type, node_type, model_id')
      .order('operation_type')
      .order('node_type'),
    svc.from('director_configs').select('version_number, model_id').eq('status', 'production').maybeSingle(),
  ])
  return {
    agent_profiles: (profiles ?? []) as AssignmentsView['agent_profiles'],
    director: director ? { version_number: director.version_number, model_id: director.model_id } : null,
  }
}

// ---- writes --------------------------------------------------------------

export interface WriteResult {
  ok: boolean
  error?: string
}

async function audit(event: string, metadata: Record<string, unknown>) {
  await writeAuditLogEntry({ event_type: event, severity: 'medium', metadata })
}

export async function addModel(input: {
  model_id: string
  display_name: string
  provider?: string
  input_dollars_per_million: number
  output_dollars_per_million: number
  cache_write_dollars_per_million?: number | null
  cache_read_dollars_per_million?: number | null
  effective_from?: string
  note?: string | null
}): Promise<WriteResult> {
  if (!MODEL_ID_RE.test(input.model_id)) return { ok: false, error: 'invalid_model_id' }
  if (!input.display_name?.trim()) return { ok: false, error: 'invalid_display_name' }
  if (!validRate(input.input_dollars_per_million) || !validRate(input.output_dollars_per_million)) {
    return { ok: false, error: 'invalid_rate' }
  }
  const svc = createServiceRoleClient()
  const effectiveFrom = input.effective_from ?? today()

  const { error: mErr } = await svc.from('llm_models').insert({
    model_id: input.model_id,
    display_name: input.display_name.trim(),
    provider: input.provider?.trim() || 'anthropic',
    status: 'active',
    note: input.note ?? null,
  })
  if (mErr) return { ok: false, error: mErr.message }

  const { error: pErr } = await svc.from('anthropic_pricing').insert({
    model_id: input.model_id,
    effective_from: effectiveFrom,
    input_dollars_per_million: input.input_dollars_per_million,
    output_dollars_per_million: input.output_dollars_per_million,
    cache_write_dollars_per_million: input.cache_write_dollars_per_million ?? null,
    cache_read_dollars_per_million: input.cache_read_dollars_per_million ?? null,
    note: input.note ?? null,
  })
  if (pErr) return { ok: false, error: pErr.message }

  await audit('admin_model_added', { model_id: input.model_id, effective_from: effectiveFrom })
  return { ok: true }
}

export async function addPricing(input: {
  model_id: string
  input_dollars_per_million: number
  output_dollars_per_million: number
  cache_write_dollars_per_million?: number | null
  cache_read_dollars_per_million?: number | null
  effective_from?: string
  note?: string | null
}): Promise<WriteResult> {
  if (!validRate(input.input_dollars_per_million) || !validRate(input.output_dollars_per_million)) {
    return { ok: false, error: 'invalid_rate' }
  }
  const svc = createServiceRoleClient()
  const effectiveFrom = input.effective_from ?? today()
  const { error } = await svc.from('anthropic_pricing').insert({
    model_id: input.model_id,
    effective_from: effectiveFrom,
    input_dollars_per_million: input.input_dollars_per_million,
    output_dollars_per_million: input.output_dollars_per_million,
    cache_write_dollars_per_million: input.cache_write_dollars_per_million ?? null,
    cache_read_dollars_per_million: input.cache_read_dollars_per_million ?? null,
    note: input.note ?? null,
  })
  if (error) return { ok: false, error: error.message }
  await audit('admin_model_repriced', { model_id: input.model_id, effective_from: effectiveFrom })
  return { ok: true }
}

export async function setModelStatus(modelId: string, status: ModelStatus): Promise<WriteResult> {
  if (status !== 'active' && status !== 'deprecated' && status !== 'hidden') {
    return { ok: false, error: 'invalid_status' }
  }
  const svc = createServiceRoleClient()
  const { error } = await svc
    .from('llm_models')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('model_id', modelId)
  if (error) return { ok: false, error: error.message }
  await audit('admin_model_status_changed', { model_id: modelId, status })
  return { ok: true }
}

export async function setProfileModel(profileId: string, modelId: string): Promise<WriteResult> {
  const svc = createServiceRoleClient()
  // Pre-validate for a clean error; the DB trigger is the hard guarantee.
  const { data: assignable } = await svc.rpc('is_model_assignable', { p_model_id: modelId })
  if (assignable !== true) return { ok: false, error: 'model_not_assignable' }
  const { error } = await svc.from('agent_profiles').update({ model_id: modelId }).eq('id', profileId)
  if (error) return { ok: false, error: error.message }
  await audit('admin_profile_model_assigned', { profile_id: profileId, model_id: modelId })
  return { ok: true }
}

export async function setDirectorModel(modelId: string): Promise<WriteResult> {
  const svc = createServiceRoleClient()
  const { data: assignable } = await svc.rpc('is_model_assignable', { p_model_id: modelId })
  if (assignable !== true) return { ok: false, error: 'model_not_assignable' }
  const { error } = await svc
    .from('director_configs')
    .update({ model_id: modelId })
    .eq('status', 'production')
  if (error) return { ok: false, error: error.message }
  await audit('admin_director_model_assigned', { model_id: modelId })
  return { ok: true }
}
