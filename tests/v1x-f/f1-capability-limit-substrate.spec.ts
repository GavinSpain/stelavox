/**
 * V1.x-F.1 — Director config v1.10 + report_capability_limit substrate.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §6 CK-F1.
 *
 * Verifies the M-146 migration applied correctly + the tool is wired
 * into the registry + the system prompt teaches self-rejection.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

function svc() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing Supabase env vars for V1.x-F test')
  return createClient(url, key)
}

test.describe('V1.x-F.1 — report_capability_limit substrate', () => {
  test('CK-F1: Director config v1.10 is the sole production row', async () => {
    const sb = svc()
    const { data, error } = await sb
      .from('director_configs')
      .select('version_number, status')
      .eq('status', 'production')
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    expect(data?.[0]?.version_number).toBe('1.10')
  })

  test('CK-F1: Director config v1.10 has 19 tools including report_capability_limit', async () => {
    const sb = svc()
    const { data } = await sb
      .from('director_configs')
      .select('tool_suite')
      .eq('version_number', '1.10')
      .single()
    const tools = data!.tool_suite as string[]
    // v1.10 was the V1.x-F.1 release config at the time of writing this test.
    // 2026-05-21 simplification didn't touch v1.10 (it's deprecated history),
    // so the original 19-tool shape including propose_brief_amendment is
    // still correct on the v1.10 row.
    expect(tools.length).toBe(19)
    expect(tools).toContain('report_capability_limit')
    expect(tools).toContain('propose_brief_amendment')
    expect(tools).toContain('cancel_brief')
  })

  test('CK-F1: v1.10 system prompt teaches self-rejection on capability limits', async () => {
    const sb = svc()
    const { data } = await sb
      .from('director_configs')
      .select('system_prompt')
      .eq('version_number', '1.10')
      .single()
    const prompt = data!.system_prompt as string
    // The appended paragraph instructs the model to call the new tool
    // BEFORE attempting partial execution.
    expect(prompt).toContain('report_capability_limit')
    expect(prompt).toContain('per-iteration')
  })

  test('CK-F1: v1.9 is now deprecated (single-production-version invariant holds)', async () => {
    const sb = svc()
    const { data } = await sb
      .from('director_configs')
      .select('status')
      .eq('version_number', '1.9')
      .single()
    expect(data?.status).toBe('deprecated')
  })
})
