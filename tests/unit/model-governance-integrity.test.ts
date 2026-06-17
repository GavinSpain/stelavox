/**
 * Model Governance P0 — SQL-layer integrity against the local DB.
 *
 * Proves the leak is structurally impossible:
 *   - is_model_assignable() gates on registered + active + currently priced
 *   - the assignability trigger REJECTS assigning an unpriced/deprecated/
 *     unknown model to agent_profiles
 *   - the pricing_rates view derives credits = dollars x 1e6 exactly
 *   - audit_metering_integrity() backstop reads zero on a clean system
 *
 * Skips when no service key (CI without the local stack).
 */

import { afterAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const createdProfileIds: string[] = []

afterAll(async () => {
  if (createdProfileIds.length) {
    await svc.from('agent_profiles').delete().in('id', createdProfileIds)
  }
})

describe.skipIf(!hasServiceKey)('Model Governance — SQL integrity', () => {
  it('is_model_assignable: active+priced=true, deprecated/unknown=false', async () => {
    const check = async (modelId: string) => {
      const { data } = await svc.rpc('is_model_assignable', { p_model_id: modelId })
      return data
    }
    expect(await check('claude-haiku-4-5-20251001')).toBe(true)
    expect(await check('claude-opus-4-8')).toBe(true)
    expect(await check('claude-opus-4-7')).toBe(false) // deprecated
    expect(await check('claude-bogus-9')).toBe(false) // unknown
  })

  it('pricing_rates view derives credits = dollars x 1,000,000', async () => {
    const { data } = await svc
      .from('pricing_rates')
      .select('model_id, input_credits_per_million, output_credits_per_million')
      .in('model_id', ['claude-haiku-4-5-20251001', 'claude-opus-4-8'])
    const byId = Object.fromEntries((data ?? []).map((r) => [r.model_id, r]))
    // haiku $0.80/$4.00 -> 800,000 / 4,000,000 credits
    expect(Number(byId['claude-haiku-4-5-20251001'].input_credits_per_million)).toBe(800_000)
    expect(Number(byId['claude-haiku-4-5-20251001'].output_credits_per_million)).toBe(4_000_000)
    // opus 4.8 $15/$75 -> 15,000,000 / 75,000,000 credits
    expect(Number(byId['claude-opus-4-8'].input_credits_per_million)).toBe(15_000_000)
    expect(Number(byId['claude-opus-4-8'].output_credits_per_million)).toBe(75_000_000)
  })

  it('trigger REJECTS assigning a deprecated model to an agent profile', async () => {
    const { error } = await svc.from('agent_profiles').insert({
      name: 'mg-test-deprecated',
      operation_type: 'refine',
      system_prompt: 'test',
      model_id: 'claude-opus-4-7', // registered but deprecated
    })
    expect(error).not.toBeNull()
    expect(error?.message ?? '').toContain('model_not_assignable')
  })

  it('FK/trigger REJECTS assigning an unknown model to an agent profile', async () => {
    const { error } = await svc.from('agent_profiles').insert({
      name: 'mg-test-unknown',
      operation_type: 'refine',
      system_prompt: 'test',
      model_id: 'claude-bogus-9',
    })
    expect(error).not.toBeNull()
  })

  it('ACCEPTS assigning a valid active+priced model', async () => {
    const { data, error } = await svc
      .from('agent_profiles')
      .insert({
        name: `mg-test-valid-${Date.now()}`,
        operation_type: 'refine',
        system_prompt: 'test',
        model_id: 'claude-haiku-4-5-20251001',
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
    if (data?.id) createdProfileIds.push(data.id)
  })

  it('audit_metering_integrity backstop reads zero', async () => {
    const { data } = await svc.rpc('audit_metering_integrity')
    const row = Array.isArray(data) ? data[0] : data
    expect(Number(row.unmetered_completed_jobs)).toBe(0)
    expect(Number(row.unpriced_agent_profiles)).toBe(0)
    expect(Number(row.unpriced_director_config)).toBe(0)
  })
})
