/**
 * V1.x-F.3 — probe-fixture-gating unit tests.
 *
 * Source: stelavox_v1x_f_build_checklist_v1_1.md §5 F.3 +
 *         lib/admin/probes/workflow-expand.ts +
 *         lib/admin/probes/refine-accept.ts.
 *
 * Both real probe implementations short-circuit gracefully when the
 * platform_config fixture pointers are absent. These tests mock the
 * config reader to verify the `probe_fixtures_not_seeded` failure
 * shape — no LLM call, no DB write, clear remediation hint.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config/platform-config', () => ({
  getConfig: vi.fn(async () => {
    throw new Error('Platform config key not found')
  }),
}))

vi.mock('@/lib/agent/runner', () => ({
  runAgentJob: vi.fn(),
}))

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: vi.fn(),
  })),
}))

import { runWorkflowExpandProbe } from '@/lib/admin/probes/workflow-expand'
import { runRefineAcceptProbe } from '@/lib/admin/probes/refine-accept'

describe('runWorkflowExpandProbe (V1.x-F.3) — fixture gating', () => {
  it('returns probe_fixtures_not_seeded when platform_config pointers absent', async () => {
    const r = await runWorkflowExpandProbe()
    expect(r.outcome).toBe('fail')
    expect(r.failure_class).toBe('E')
    expect(r.error_message).toMatch(/probe_fixtures_not_seeded/)
    expect(r.metadata).toEqual({
      remediation: 'npm run script scripts/seed-probe-fixtures.ts',
    })
    expect(r.duration_ms).toBe(0)
  })

  it('does NOT throw when fixtures absent (graceful failure shape)', async () => {
    await expect(runWorkflowExpandProbe()).resolves.toBeDefined()
  })
})

describe('runRefineAcceptProbe (V1.x-F.3) — fixture gating', () => {
  it('returns probe_fixtures_not_seeded when platform_config pointers absent', async () => {
    const r = await runRefineAcceptProbe()
    expect(r.outcome).toBe('fail')
    expect(r.failure_class).toBe('E')
    expect(r.error_message).toMatch(/probe_fixtures_not_seeded/)
    expect(r.metadata).toEqual({
      remediation: 'npm run script scripts/seed-probe-fixtures.ts',
    })
  })

  it('does NOT throw when fixtures absent', async () => {
    await expect(runRefineAcceptProbe()).resolves.toBeDefined()
  })
})

describe('probe runner dispatch (V1.x-F.3)', () => {
  it('isValidProbeId covers all 3 V1.x probes (regression on V1.x-F.3 wiring)', async () => {
    const { isValidProbeId } = await import('@/lib/admin/probes/runner')
    expect(isValidProbeId('director_small')).toBe(true)
    expect(isValidProbeId('workflow_expand')).toBe(true)
    expect(isValidProbeId('refine_accept')).toBe(true)
    expect(isValidProbeId('garbage')).toBe(false)
  })
})
