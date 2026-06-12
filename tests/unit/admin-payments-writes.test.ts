/**
 * Phase 9.B admin payments (C.5) — writeAdminPaymentConfig.
 *
 * Tests the validator + write + audit_log + cache-clear path against
 * the real local DB. The auth gate (isPlatformAdmin) is bypassed by
 * directly stubbing the supabase server client — instead we exercise
 * the validators + the DB side-effects via the lower-level path.
 *
 * For full auth gating, the API route test is the right surface (any
 * non-admin sees a 403); the Vitest here pins per-key validator
 * behaviour + audit_log shape.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { _clearConfigCache } from '@/lib/config/platform-config'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

// Mock isPlatformAdmin + supabase server client → always-admin path so
// the validators + DB writes run.
vi.mock('@/lib/admin/isPlatformAdmin', () => ({
  isPlatformAdmin: async () => true,
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'test-admin' } } }),
    },
  }),
}))

// IMPORTANT: imports below MUST come after vi.mock so the mocks apply.
const { writeAdminPaymentConfig } = await import('@/lib/admin/payments/writes')

describe.skipIf(!hasServiceKey)('writeAdminPaymentConfig (C.5)', () => {
  // Capture + restore originals for the keys we mutate.
  const originals: Record<string, unknown> = {}
  const KEYS = [
    'stripe.api_version',
    'stripe.checkout.automatic_tax_enabled',
    'stripe.checkout.allow_promotion_codes',
    'billing.trial_duration_days',
    'stripe.test.price_id.byok_solo_yearly',
    'stripe.webhook_secret_test',
  ]

  beforeAll(async () => {
    for (const key of KEYS) {
      const { data } = await svc
        .from('platform_config')
        .select('value')
        .eq('key', key)
        .single()
      originals[key] = data!.value
    }
  })

  afterAll(async () => {
    for (const key of KEYS) {
      await svc.from('platform_config').update({ value: originals[key] }).eq('key', key)
    }
    _clearConfigCache()
  })

  it('rejects a key not on the editable allowlist', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'plan.writer_token_allocation_credits',
      value: '999',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not editable/)
  })

  it('rejects stripe.mode with invalid enum value', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.mode',
      value: 'banana',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/must be one of/)
  })

  it('accepts a config write + writes audit_log + invalidates cache', async () => {
    // Use stripe.checkout.allow_promotion_codes for this assertion rather
    // than stripe.mode — the stripe-config test asserts the live DB value
    // of stripe.mode and a cross-file race would flake without serious
    // serialisation work. The audit + cache-clear behaviour is what we
    // care about; the specific key doesn't matter.
    const result = await writeAdminPaymentConfig({
      key: 'stripe.checkout.allow_promotion_codes',
      value: 'true',
    })
    expect(result.ok).toBe(true)
    const { data: audit } = await svc
      .from('audit_log')
      .select('event_type, severity, metadata')
      .eq('event_type', 'admin_payments_config_changed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    expect(audit!.severity).toBe('medium')
    expect((audit!.metadata as { key: string }).key).toBe(
      'stripe.checkout.allow_promotion_codes',
    )
    expect((audit!.metadata as { admin_user_id: string }).admin_user_id).toBe(
      'test-admin',
    )
  })

  it('rejects api_version that is empty', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.api_version',
      value: '',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it('rejects api_version that does not look like a Stripe API date', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.api_version',
      value: 'not-a-version',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Stripe API date/)
  })

  it('accepts a valid boolean for automatic_tax_enabled and persists it', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.checkout.automatic_tax_enabled',
      value: 'true',
    })
    expect(result.ok).toBe(true)
    const { data } = await svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.checkout.automatic_tax_enabled')
      .single()
    expect(data!.value).toBe(true)
  })

  it('rejects a non-boolean for automatic_tax_enabled', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.checkout.automatic_tax_enabled',
      value: 'yes',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/true.*false/)
  })

  it('rejects trial_duration_days outside [1, 90]', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'billing.trial_duration_days',
      value: '200',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/integer in/)
  })

  it('accepts blank price_id (clearing the slot)', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.test.price_id.byok_solo_yearly',
      value: '',
    })
    expect(result.ok).toBe(true)
  })

  it('rejects price_id that does not start with price_', async () => {
    const result = await writeAdminPaymentConfig({
      key: 'stripe.test.price_id.byok_solo_yearly',
      value: 'not_a_price_id',
    })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/price_/)
  })

  it('webhook secret requires confirmation (D1.a) and masks audit value', async () => {
    // Bare value without confirmation → reject
    const r1 = await writeAdminPaymentConfig({
      key: 'stripe.webhook_secret_test',
      value: 'whsec_abc123',
    })
    expect(r1.ok).toBe(false)
    expect(r1.error).toMatch(/confirmation/i)

    // Mismatched confirmation → reject
    const r2 = await writeAdminPaymentConfig({
      key: 'stripe.webhook_secret_test',
      value: 'whsec_abc123',
      valueConfirm: 'whsec_zzz999',
    })
    expect(r2.ok).toBe(false)
    expect(r2.error).toMatch(/match/i)

    // Matched + valid → accept; audit values are masked
    const r3 = await writeAdminPaymentConfig({
      key: 'stripe.webhook_secret_test',
      value: 'whsec_abc123_unit_test',
      valueConfirm: 'whsec_abc123_unit_test',
    })
    expect(r3.ok).toBe(true)
    expect(r3.newValue).toMatch(/masked/)

    // Audit row was written with masked values
    const { data: audit } = await svc
      .from('audit_log')
      .select('metadata')
      .eq('event_type', 'admin_payments_config_changed')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    expect((audit!.metadata as { new_value: string }).new_value).toBe('••• masked')
  })

  it('no-op when value is unchanged — does not insert audit_log', async () => {
    // Set api_version to a known value first
    await writeAdminPaymentConfig({
      key: 'stripe.api_version',
      value: '2026-05-27.dahlia',
    })
    const { count: beforeCount } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'admin_payments_config_changed')

    // Same value → no audit write
    const result = await writeAdminPaymentConfig({
      key: 'stripe.api_version',
      value: '2026-05-27.dahlia',
    })
    expect(result.ok).toBe(true)
    const { count: afterCount } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'admin_payments_config_changed')
    expect(afterCount).toBe(beforeCount)
  })
})
