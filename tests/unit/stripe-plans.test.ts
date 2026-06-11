/**
 * Phase 9.B Session 2 — plan ↔ Stripe Price ID reverse lookup.
 *
 * The webhook handler maps an incoming `stripe_price_id` to one of our
 * plan slugs to set organisations.plan. Both modes are inspected so a
 * misrouted webhook surfaces as a no-match rather than a silent
 * wrong-mode mapping.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { _clearConfigCache } from '@/lib/config/platform-config'
import { getPlanAllocationCredits, isByokPlan, priceIdToPlan } from '@/lib/stripe/plans'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

describe('isByokPlan', () => {
  it('returns true for byok_solo only (V1 BYOK plan)', () => {
    expect(isByokPlan('byok_solo')).toBe(true)
    expect(isByokPlan('writer')).toBe(false)
    expect(isByokPlan('author')).toBe(false)
    expect(isByokPlan('pro')).toBe(false)
  })
})

describe.skipIf(!hasServiceKey)('priceIdToPlan', () => {
  // Seed test-mode placeholder Price IDs for the duration of the suite
  // so the reverse lookup has something to match.
  const TEST_KEYS = [
    { key: 'stripe.test.price_id.writer_monthly', value: 'price_phase9b_writer' },
    { key: 'stripe.test.price_id.author_monthly', value: 'price_phase9b_author' },
    { key: 'stripe.test.price_id.pro_monthly', value: 'price_phase9b_pro' },
    { key: 'stripe.test.price_id.byok_solo_monthly', value: 'price_phase9b_byok_solo' },
  ]
  const originals: Record<string, unknown> = {}

  beforeAll(async () => {
    for (const { key, value } of TEST_KEYS) {
      const { data } = await svc
        .from('platform_config')
        .select('value')
        .eq('key', key)
        .single()
      originals[key] = data!.value
      await svc.from('platform_config').update({ value }).eq('key', key)
    }
    _clearConfigCache()
  })

  afterAll(async () => {
    for (const { key } of TEST_KEYS) {
      await svc.from('platform_config').update({ value: originals[key] }).eq('key', key)
    }
    _clearConfigCache()
  })

  it('returns null for an empty/missing price ID', async () => {
    expect(await priceIdToPlan('')).toBeNull()
  })

  it('returns null for an unknown price ID', async () => {
    expect(await priceIdToPlan('price_unknown_xyz')).toBeNull()
  })

  it('maps each seeded test-mode Price ID to its plan slug', async () => {
    expect(await priceIdToPlan('price_phase9b_writer')).toEqual({ plan: 'writer', mode: 'test' })
    expect(await priceIdToPlan('price_phase9b_author')).toEqual({ plan: 'author', mode: 'test' })
    expect(await priceIdToPlan('price_phase9b_pro')).toEqual({ plan: 'pro', mode: 'test' })
    expect(await priceIdToPlan('price_phase9b_byok_solo')).toEqual({ plan: 'byok_solo', mode: 'test' })
  })
})

describe.skipIf(!hasServiceKey)('getPlanAllocationCredits', () => {
  it('returns null for BYOK plans (no platform credit cap)', async () => {
    expect(await getPlanAllocationCredits('byok_solo')).toBeNull()
  })

  it('returns a positive number for each platform plan', async () => {
    const writer = await getPlanAllocationCredits('writer')
    const author = await getPlanAllocationCredits('author')
    const pro = await getPlanAllocationCredits('pro')
    expect(writer).toBeGreaterThan(0)
    expect(author).toBeGreaterThan(0)
    expect(pro).toBeGreaterThan(0)
    // Per the seed: pro > author > writer
    expect(pro).toBeGreaterThan(author!)
    expect(author).toBeGreaterThan(writer!)
  })
})
