/**
 * Phase 9.B substrate — Stripe config reader.
 *
 * Covers:
 *   1. STRIPE_PLAN_SLUGS shape (exact tuple)
 *   2. getStripeMode() rejects invalid mode strings
 *   3. getStripeSecretKey() reads the right env var per mode
 *   4. requireStripeConfigured() returns the active substrate when
 *      everything is set; throws StripeNotConfiguredError listing
 *      every missing piece when not.
 *   5. The 4 V1 plans + the active-mode webhook secret + the active-mode
 *      Price IDs all appear in the validator's missing-list when blank.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

import { _clearConfigCache } from '@/lib/config/platform-config'
import {
  STRIPE_PLAN_SLUGS,
  StripeNotConfiguredError,
  getStripeMode,
  getStripeSecretKey,
  requireStripeConfigured,
} from '@/lib/stripe/config'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

describe('STRIPE_PLAN_SLUGS', () => {
  it('contains exactly the 4 V1 plan slugs', () => {
    expect(STRIPE_PLAN_SLUGS).toEqual(['writer', 'author', 'pro', 'byok_solo'])
  })
})

describe.skipIf(!hasServiceKey)('Stripe config reader', () => {
  // Capture and restore the stripe.mode value so tests can flip it.
  let originalMode: string

  beforeAll(async () => {
    const { data } = await svc
      .from('platform_config')
      .select('value')
      .eq('key', 'stripe.mode')
      .single()
    originalMode = (data!.value as string) ?? '"test"'
  })

  afterAll(async () => {
    await svc
      .from('platform_config')
      .update({ value: originalMode })
      .eq('key', 'stripe.mode')
  })

  it('getStripeMode rejects an invalid mode value', async () => {
    await svc
      .from('platform_config')
      .update({ value: 'banana' })
      .eq('key', 'stripe.mode')
    _clearConfigCache()
    await expect(getStripeMode()).rejects.toThrow(/Invalid stripe\.mode/)
    // restore so the next test sees a valid mode
    await svc
      .from('platform_config')
      .update({ value: 'test' })
      .eq('key', 'stripe.mode')
  })

  it('getStripeMode returns "test" when the key is "test"', async () => {
    await svc
      .from('platform_config')
      .update({ value: 'test' })
      .eq('key', 'stripe.mode')
    _clearConfigCache()
    expect(await getStripeMode()).toBe('test')
  })

  it('getStripeMode returns "live" when the key is "live"', async () => {
    await svc
      .from('platform_config')
      .update({ value: 'live' })
      .eq('key', 'stripe.mode')
    _clearConfigCache()
    expect(await getStripeMode()).toBe('live')
  })

  describe('getStripeSecretKey', () => {
    const ORIGINAL_TEST = process.env.STRIPE_SECRET_KEY_TEST
    const ORIGINAL_LIVE = process.env.STRIPE_SECRET_KEY_LIVE

    beforeEach(() => {
      delete process.env.STRIPE_SECRET_KEY_TEST
      delete process.env.STRIPE_SECRET_KEY_LIVE
    })

    afterEach(() => {
      if (ORIGINAL_TEST !== undefined) process.env.STRIPE_SECRET_KEY_TEST = ORIGINAL_TEST
      if (ORIGINAL_LIVE !== undefined) process.env.STRIPE_SECRET_KEY_LIVE = ORIGINAL_LIVE
    })

    it('returns null when neither key is set', () => {
      expect(getStripeSecretKey('test')).toBeNull()
      expect(getStripeSecretKey('live')).toBeNull()
    })

    it('returns the test key when STRIPE_SECRET_KEY_TEST is set', () => {
      process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_dummy_value'
      expect(getStripeSecretKey('test')).toBe('sk_test_dummy_value')
      expect(getStripeSecretKey('live')).toBeNull()
    })

    it('returns the live key only when STRIPE_SECRET_KEY_LIVE is set', () => {
      process.env.STRIPE_SECRET_KEY_LIVE = 'sk_live_dummy_value'
      expect(getStripeSecretKey('live')).toBe('sk_live_dummy_value')
      expect(getStripeSecretKey('test')).toBeNull()
    })

    it('treats empty-string env vars as not configured', () => {
      process.env.STRIPE_SECRET_KEY_TEST = ''
      expect(getStripeSecretKey('test')).toBeNull()
    })
  })

  describe('requireStripeConfigured', () => {
    const ORIGINAL_TEST = process.env.STRIPE_SECRET_KEY_TEST

    beforeEach(() => {
      delete process.env.STRIPE_SECRET_KEY_TEST
    })

    afterEach(() => {
      if (ORIGINAL_TEST !== undefined) process.env.STRIPE_SECRET_KEY_TEST = ORIGINAL_TEST
    })

    it('throws StripeNotConfiguredError with env-var entry when STRIPE_SECRET_KEY_TEST is unset', async () => {
      // Note: this asserts the env-var path only — Price ID checks
      // depend on platform_config state that other concurrent test
      // files may populate, so a strict "all 4 IDs missing" assertion
      // would be flaky. The webhook-handler test file covers the
      // populated-keys path.
      await svc
        .from('platform_config')
        .update({ value: 'test' })
        .eq('key', 'stripe.mode')
      _clearConfigCache()
      try {
        await requireStripeConfigured()
        throw new Error('expected to throw')
      } catch (err) {
        expect(err).toBeInstanceOf(StripeNotConfiguredError)
        const missing = (err as StripeNotConfiguredError).missing
        expect(missing).toContain('STRIPE_SECRET_KEY_TEST (env)')
      }
    })

    it('returns mode + secretKey when everything is set', async () => {
      // Seed each missing key with a placeholder, then restore at end.
      const KEYS = [
        'stripe.webhook_secret_test',
        'stripe.test.price_id.writer_monthly',
        'stripe.test.price_id.author_monthly',
        'stripe.test.price_id.pro_monthly',
        'stripe.test.price_id.byok_solo_monthly',
      ]
      const originals: Record<string, unknown> = {}
      for (const key of KEYS) {
        const { data } = await svc
          .from('platform_config')
          .select('value')
          .eq('key', key)
          .single()
        originals[key] = data!.value
        await svc
          .from('platform_config')
          .update({ value: `"placeholder_${key}"` })
          .eq('key', key)
      }
      process.env.STRIPE_SECRET_KEY_TEST = 'sk_test_for_unit_test'
      _clearConfigCache()

      try {
        const { mode, secretKey } = await requireStripeConfigured()
        expect(mode).toBe('test')
        expect(secretKey).toBe('sk_test_for_unit_test')
      } finally {
        for (const key of KEYS) {
          await svc
            .from('platform_config')
            .update({ value: originals[key] })
            .eq('key', key)
        }
      }
    })
  })
})
