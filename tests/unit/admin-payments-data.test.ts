/**
 * Phase 9.B admin payments (C.4) — data loader shape.
 *
 * Exercises loadAdminPaymentsData against the local DB. The page +
 * client component depend on this exact shape; failures here surface
 * before any UI rendering attempt.
 */

import { describe, expect, it } from 'vitest'

import { loadAdminPaymentsData } from '@/lib/admin/payments/data'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('loadAdminPaymentsData (C.4)', () => {
  it('returns every top-level section', async () => {
    const data = await loadAdminPaymentsData()
    expect(data).toHaveProperty('config')
    expect(data).toHaveProperty('priceIds')
    expect(data).toHaveProperty('health')
    expect(data).toHaveProperty('events')
    expect(data).toHaveProperty('failures')
  })

  it('config section carries every M-219 + M-223 key', async () => {
    const { config } = await loadAdminPaymentsData()
    // Tolerant of concurrent stripe-config tests that briefly flip the
    // mode value to an invalid placeholder for validator assertions.
    expect(typeof config.stripeMode).toBe('string')
    expect(config.stripeMode.length).toBeGreaterThan(0)
    expect(config.stripeApiVersion).toMatch(/^\d{4}-\d{2}-\d{2}/)
    expect(typeof config.checkoutAutomaticTaxEnabled).toBe('boolean')
    expect(typeof config.checkoutAllowPromotionCodes).toBe('boolean')
    expect(['auto', 'required']).toContain(config.checkoutBillingAddressCollection)
    expect(typeof config.trialDurationDays).toBe('number')
    expect(typeof config.paymentFailureGraceDays).toBe('number')
    expect(typeof config.stripeSecretKeyTestSet).toBe('boolean')
    expect(typeof config.stripeSecretKeyLiveSet).toBe('boolean')
    expect(config.planAllocations).toHaveProperty('writer')
    expect(config.planAllocations).toHaveProperty('author')
    expect(config.planAllocations).toHaveProperty('pro')
    expect(config.planAllocations).toHaveProperty('trial')
  })

  it('priceIds returns 16 slots (4 plans × 2 cadences × 2 modes)', async () => {
    const { priceIds } = await loadAdminPaymentsData()
    expect(priceIds).toHaveLength(16)
    const modes = new Set(priceIds.map((p) => p.mode))
    expect(modes).toEqual(new Set(['test', 'live']))
    const plans = new Set(priceIds.map((p) => p.plan))
    expect(plans).toEqual(new Set(['writer', 'author', 'pro', 'byok_solo']))
    const cadences = new Set(priceIds.map((p) => p.cadence))
    expect(cadences).toEqual(new Set(['monthly', 'yearly']))
  })

  it('health section shape — counts + pastDueOrgs + trialsExpiringSoon + mrr', async () => {
    const { health } = await loadAdminPaymentsData()
    expect(typeof health.countByStatus).toBe('object')
    expect(Array.isArray(health.pastDueOrgs)).toBe(true)
    expect(Array.isArray(health.trialsExpiringSoon)).toBe(true)
    expect(typeof health.estimatedMrrCents).toBe('number')
    expect(health.estimatedMrrCents).toBeGreaterThanOrEqual(0)
  })

  it('events + failures arrays are bounded (≤ 50)', async () => {
    const data = await loadAdminPaymentsData()
    expect(data.events.length).toBeLessThanOrEqual(50)
    expect(data.failures.length).toBeLessThanOrEqual(50)
  })
})
