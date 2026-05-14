/**
 * V1.x-B.1.1 — atom-size guardrails preflightCheck unit tests.
 *
 * These don't hit the live database — they mock the platform_config
 * read so the test exercises the threshold logic + message shape only.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/config/platform-config', () => ({
  getConfig: vi.fn(),
}))

import { preflightCheck, getCap } from '@/lib/constraints/preflight'
import { getConfig } from '@/lib/config/platform-config'

const mockedGetConfig = vi.mocked(getConfig)

describe('preflightCheck', () => {
  beforeEach(() => {
    mockedGetConfig.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok when value is below cap', async () => {
    mockedGetConfig.mockResolvedValue(524288)
    const r = await preflightCheck('tool_result_size_exceeded', 1000)
    expect(r.ok).toBe(true)
  })

  it('returns ok when value equals cap', async () => {
    mockedGetConfig.mockResolvedValue(524288)
    const r = await preflightCheck('tool_result_size_exceeded', 524288)
    expect(r.ok).toBe(true)
  })

  it('returns violation when value exceeds cap', async () => {
    mockedGetConfig.mockResolvedValue(524288)
    const r = await preflightCheck('tool_result_size_exceeded', 1_000_000)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.violation.type).toBe('tool_result_size_exceeded')
      expect(r.violation.attempted_value).toBe(1_000_000)
      expect(r.violation.configured_cap).toBe(524288)
      expect(r.violation.message).toContain('1000000')
      expect(r.violation.message).toContain('524288')
    }
  })

  it('uses default cap when platform_config returns null', async () => {
    mockedGetConfig.mockResolvedValue(null)
    const cap = await getCap('tool_result_size_exceeded')
    expect(cap).toBe(524288)
  })

  it('handles iterations_per_turn_exceeded with the correct default', async () => {
    mockedGetConfig.mockResolvedValue(null)
    const cap = await getCap('iterations_per_turn_exceeded')
    expect(cap).toBe(20)
  })

  it('handles profile_size_warned with the correct default', async () => {
    mockedGetConfig.mockResolvedValue(null)
    const cap = await getCap('profile_size_warned')
    expect(cap).toBe(65536)
  })

  it('produces a clear message for each violation type', async () => {
    mockedGetConfig.mockResolvedValue(10)

    const r1 = await preflightCheck('tool_result_size_exceeded', 100)
    if (!r1.ok) expect(r1.violation.message).toMatch(/Tool result size/)

    const r2 = await preflightCheck('iterations_per_turn_exceeded', 100)
    if (!r2.ok) expect(r2.violation.message).toMatch(/Director turn reached/)

    const r3 = await preflightCheck('profile_size_warned', 100)
    if (!r3.ok) expect(r3.violation.message).toMatch(/Project Profile reached/)
  })
})
