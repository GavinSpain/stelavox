/**
 * V1.x-F.2 — failure-message templates substrate.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §5 F.2.
 *
 * Verifies the M-147 migration applied correctly + all 6 platform_config
 * keys present with the expected value_types.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for V1.x-F test')
  return createClient(url, key)
}

const EXPECTED_KEYS: ReadonlyArray<{ key: string; value_type: 'string' | 'integer' }> = [
  { key: 'failure.class_a_message', value_type: 'string' },
  { key: 'failure.class_c_message', value_type: 'string' },
  { key: 'failure.class_c_min_pause_seconds', value_type: 'integer' },
  { key: 'failure.class_d_message_template', value_type: 'string' },
  { key: 'failure.class_e_admin_contact', value_type: 'string' },
  { key: 'failure.class_e_message', value_type: 'string' },
]

test.describe('V1.x-F.2 — failure-message templates substrate', () => {
  test('CK-F2: all 6 failure.* platform_config keys are present', async () => {
    const sb = svc()
    const { data, error } = await sb
      .from('platform_config')
      .select('key, value_type')
      .like('key', 'failure.%')
      .order('key', { ascending: true })

    expect(error).toBeNull()
    expect(data?.length).toBe(6)
    const got = (data ?? []).map((r) => ({ key: r.key, value_type: r.value_type }))
    expect(got).toEqual(EXPECTED_KEYS)
  })

  test('CK-F2: failure.class_c_min_pause_seconds defaults to 15 (D2 decision)', async () => {
    const sb = svc()
    const { data } = await sb
      .from('platform_config')
      .select('value')
      .eq('key', 'failure.class_c_min_pause_seconds')
      .single()
    expect(Number(data?.value)).toBe(15)
  })

  test('CK-F2: failure.class_e_admin_contact defaults to support@stelavox.io (D3 decision)', async () => {
    const sb = svc()
    const { data } = await sb
      .from('platform_config')
      .select('value')
      .eq('key', 'failure.class_e_admin_contact')
      .single()
    // value comes back as a JSONB string — the quoted form.
    const v = data?.value as string
    const unwrapped = typeof v === 'string' ? v : JSON.stringify(v)
    expect(unwrapped).toContain('support@stelavox.io')
  })

  test('CK-F2: Class D template carries the {reason} token', async () => {
    const sb = svc()
    const { data } = await sb
      .from('platform_config')
      .select('value')
      .eq('key', 'failure.class_d_message_template')
      .single()
    const v = data?.value as string
    expect(v).toContain('{reason}')
    expect(v).toContain('{node_name}')
    expect(v).toContain('{failure_class}')
  })

  test('CK-F2: Class E template carries the {job_id} token', async () => {
    const sb = svc()
    const { data } = await sb
      .from('platform_config')
      .select('value')
      .eq('key', 'failure.class_e_message')
      .single()
    const v = data?.value as string
    expect(v).toContain('{job_id}')
  })
})
