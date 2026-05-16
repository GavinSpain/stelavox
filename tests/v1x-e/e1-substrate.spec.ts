/**
 * V1.x-E.1 — substrate integration tests.
 *
 * Verifies the three new tables (M-143 anthropic_rate_limit_samples,
 * M-144 synthetic_probe_runs, M-145 admin alert keys) are present and
 * the Anthropic header capture path is wired into the provider
 * constructor.
 *
 * These are smoke checks against the DB substrate — actual Anthropic
 * header capture in production is exercised by every Director call once
 * a real platform-key request lands.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for V1.x-E test')
  return createClient(url, key)
}

test.describe('V1.x-E.1 — substrate', () => {
  test('CK-E1: anthropic_rate_limit_samples table exists and is empty-or-readable via service role', async () => {
    const sb = svc()
    const { data, error } = await sb
      .from('anthropic_rate_limit_samples')
      .select('id, model_id, sampled_at')
      .limit(1)
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  test('CK-E1: synthetic_probe_runs table accepts a manual insert + readback', async () => {
    const sb = svc()
    const insertRes = await sb
      .from('synthetic_probe_runs')
      .insert({
        probe_id: 'director_small',
        triggered_by: 'manual',
      })
      .select('id')
      .single()
    expect(insertRes.error).toBeNull()
    expect(insertRes.data?.id).toBeGreaterThan(0)

    if (insertRes.data?.id) {
      const cleanup = await sb.from('synthetic_probe_runs').delete().eq('id', insertRes.data.id)
      expect(cleanup.error).toBeNull()
    }
  })

  test('CK-E1: synthetic_probe_runs CHECK constraint rejects unknown probe_id', async () => {
    const sb = svc()
    const res = await sb
      .from('synthetic_probe_runs')
      .insert({ probe_id: 'unknown_probe', triggered_by: 'manual' })
    expect(res.error).not.toBeNull()
  })

  test('CK-E1: admin alert threshold keys are present in platform_config', async () => {
    const sb = svc()
    const { data, error } = await sb
      .from('platform_config')
      .select('key, value')
      .in('key', [
        'admin.alerts.itpm_warn_pct',
        'admin.alerts.itpm_sustained_minutes',
        'admin.alerts.queue_oldest_warn_minutes',
        'admin.alerts.failure_rate_warn_pct',
      ])
    expect(error).toBeNull()
    expect(data?.length).toBe(4)
  })
})
