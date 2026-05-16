/**
 * V1.x-E.2 — capacityAlerts evaluator unit tests.
 *
 * Tests the three alert kinds against canned threshold values + canned
 * dashboard-context inputs. The platform_config getConfigInt() reads
 * are mocked so the test does not require a live DB.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config/platform-config', () => ({
  getConfigInt: vi.fn(async (key: string) => {
    switch (key) {
      case 'admin.alerts.itpm_warn_pct':
        return 75
      case 'admin.alerts.itpm_sustained_minutes':
        return 10
      case 'admin.alerts.queue_oldest_warn_minutes':
        return 15
      case 'admin.alerts.failure_rate_warn_pct':
        return 15
      default:
        throw new Error(`unexpected key ${key}`)
    }
  }),
}))

import { evaluateCapacityAlerts } from '@/lib/admin/capacityAlerts'

interface FakeQuery {
  select: () => FakeQuery
  eq: () => FakeQuery
  gte: () => FakeQuery
  order: () => FakeQuery
  limit: () => FakeQuery
  then: (resolve: (v: unknown) => void) => void
}

function buildFakeSvc(opts: {
  rateLimitSamples?: Record<string, Array<{ sampled_at: string; input_tokens_limit: number; input_tokens_remaining: number }>>
  oldestQueuedAt?: string | null
}): unknown {
  return {
    from(table: string) {
      if (table === 'anthropic_rate_limit_samples') {
        let modelFilter = ''
        const fq: FakeQuery = {
          select: () => fq,
          eq(_col: string, val: string) {
            modelFilter = val
            return fq
          },
          gte: () => fq,
          order: () => fq,
          limit: () => fq,
          then(resolve: (v: unknown) => void) {
            const samples = opts.rateLimitSamples?.[modelFilter] ?? []
            resolve({ data: samples.map((s) => ({ ...s, model_id: modelFilter })) })
          },
        } as unknown as FakeQuery
        return fq
      }
      if (table === 'agent_jobs') {
        const fq: FakeQuery = {
          select: () => fq,
          eq: () => fq,
          gte: () => fq,
          order: () => fq,
          limit: () => fq,
          then(resolve: (v: unknown) => void) {
            const data = opts.oldestQueuedAt === undefined
              ? []
              : [{ queued_at: opts.oldestQueuedAt }]
            resolve({ data })
          },
        } as unknown as FakeQuery
        return fq
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
}

describe('evaluateCapacityAlerts (V1.x-E.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns no alerts when nothing exceeds thresholds', async () => {
    const svc = buildFakeSvc({}) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [
        { model_id: 'claude-sonnet-4-6', input_tokens_limit: 100, input_tokens_remaining: 90 },
      ],
      queueDepthByClass: [
        { traffic_class: 1, count: 0 },
        { traffic_class: 4, count: 0 },
      ],
      failuresInWindow: 0,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toEqual([])
  })

  it('fires anthropic_itpm_high when current AND every sample in window are above threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'))
    // Fill the 10-min window with samples all at 80% utilisation.
    const fillSamples = Array.from({ length: 10 }, (_, i) => ({
      sampled_at: new Date(Date.now() - (10 - i) * 60 * 1000).toISOString(),
      input_tokens_limit: 100,
      input_tokens_remaining: 20, // 80% utilisation
    }))
    const svc = buildFakeSvc({
      rateLimitSamples: { 'claude-sonnet-4-6': fillSamples },
    }) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [
        { model_id: 'claude-sonnet-4-6', input_tokens_limit: 100, input_tokens_remaining: 20 },
      ],
      queueDepthByClass: [],
      failuresInWindow: 0,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.kind).toBe('anthropic_itpm_high')
    expect(alerts[0]?.model_id).toBe('claude-sonnet-4-6')
    expect(alerts[0]?.value).toBe(80)
  })

  it('does NOT fire anthropic_itpm_high if any sample in window dipped below threshold', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'))
    const samples = [
      { sampled_at: new Date(Date.now() - 9 * 60 * 1000).toISOString(), input_tokens_limit: 100, input_tokens_remaining: 60 }, // 40% util — dip
      { sampled_at: new Date(Date.now() - 1 * 60 * 1000).toISOString(), input_tokens_limit: 100, input_tokens_remaining: 20 }, // 80% util
    ]
    const svc = buildFakeSvc({
      rateLimitSamples: { 'claude-sonnet-4-6': samples },
    }) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [
        { model_id: 'claude-sonnet-4-6', input_tokens_limit: 100, input_tokens_remaining: 20 },
      ],
      queueDepthByClass: [],
      failuresInWindow: 0,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toEqual([])
  })

  it('fires queue_oldest_stale when oldest queued age exceeds threshold', async () => {
    const oldQueuedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString() // 20 min old
    const svc = buildFakeSvc({ oldestQueuedAt: oldQueuedAt }) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [],
      queueDepthByClass: [],
      failuresInWindow: 0,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.kind).toBe('queue_oldest_stale')
    expect(alerts[0]?.value).toBeGreaterThanOrEqual(15)
  })

  it('does NOT fire queue_oldest_stale when queue is empty', async () => {
    const svc = buildFakeSvc({}) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [],
      queueDepthByClass: [],
      failuresInWindow: 0,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toEqual([])
  })

  it('fires failure_rate_high when window failure rate >= threshold', async () => {
    const svc = buildFakeSvc({}) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [],
      queueDepthByClass: [],
      failuresInWindow: 30,
      totalSamplesInWindow: 100,
    })
    expect(alerts).toHaveLength(1)
    expect(alerts[0]?.kind).toBe('failure_rate_high')
    expect(alerts[0]?.value).toBe(30)
  })

  it('does NOT fire failure_rate_high when totalSamplesInWindow is 0', async () => {
    const svc = buildFakeSvc({}) as never
    const alerts = await evaluateCapacityAlerts(svc, {
      headroomByModel: [],
      queueDepthByClass: [],
      failuresInWindow: 5,
      totalSamplesInWindow: 0,
    })
    expect(alerts).toEqual([])
  })
})
