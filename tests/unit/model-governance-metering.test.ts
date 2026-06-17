/**
 * Model Governance P0 — code-layer metering integrity (the leak is closed).
 *
 * Proves the two fail-CLOSED code paths:
 *   1. computeCompletionCredits NEVER returns null — an unpriced model is
 *      debited at the fallback rate + a critical audit is written (no free
 *      usage), and a priced model is debited exactly with no audit.
 *   2. checkTokenBudget REFUSES dispatch (and audits) when the model has no
 *      pricing row — was fail-open (return true), the leak this closes.
 *
 * The SQL-layer integrity (registry FK, is_model_assignable trigger,
 * pricing_rates view parity, audit_metering_integrity backstop) is proven in
 * model-governance-integrity.test.ts against the live DB.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/config/platform-config', () => ({
  getConfigInt: vi.fn(async (key: string) => {
    if (key === 'pricing.fallback_credits_per_million_input') return 15_000_000
    if (key === 'pricing.fallback_credits_per_million_output') return 75_000_000
    if (key === 'plan.over_limit_grace_credits') return 0
    return 0
  }),
}))
vi.mock('@/lib/security/audit', () => ({ writeAuditLogEntry: vi.fn() }))
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }))

import { getConfigInt } from '@/lib/config/platform-config'
import { writeAuditLogEntry } from '@/lib/security/audit'
import { createServiceRoleClient } from '@/lib/supabase/service'

const mockedCreateClient = createServiceRoleClient as unknown as ReturnType<typeof vi.fn>

interface PricingRowShape {
  model_id: string
  effective_from: string
  input_credits_per_million: number
  output_credits_per_million: number
  cache_write_credits_per_million: number | null
  cache_read_credits_per_million: number | null
  effective_until: string | null
}

/** Mock client whose pricing_rates lookup returns `pricingRow` (or empty). */
function pricingClient(pricingRow: PricingRowShape | null) {
  let lastTable = ''
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.lte = () => chain
  chain.order = () => chain
  chain.limit = () =>
    Promise.resolve({ data: lastTable === 'pricing_rates' && pricingRow ? [pricingRow] : [], error: null })
  return {
    from: (t: string) => {
      lastTable = t
      return chain
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>
}

/** Mock client for the admission gate (org reads + pricing_rates). */
function gateClient(opts: {
  allocation: number | null
  usage: number | null
  pricingRow: PricingRowShape | null
}) {
  let lastTable = ''
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.lte = () => chain
  chain.order = () => chain
  chain.limit = () =>
    Promise.resolve({ data: lastTable === 'pricing_rates' && opts.pricingRow ? [opts.pricingRow] : [], error: null })
  chain.maybeSingle = () => {
    if (lastTable === 'organisations') {
      // First gate read = subscription_status (no field → not past_due);
      // second = allocation/usage. Returning both keys on one object serves both.
      return Promise.resolve({
        data: { token_allocation_credits: opts.allocation, token_usage_credits: opts.usage },
        error: null,
      })
    }
    return Promise.resolve({ data: null, error: null })
  }
  return {
    from: (t: string) => {
      lastTable = t
      return chain
    },
  } as unknown as ReturnType<typeof createServiceRoleClient>
}

const HAIKU: PricingRowShape = {
  model_id: 'claude-haiku-4-5-20251001',
  effective_from: '2026-05-01',
  input_credits_per_million: 800_000,
  output_credits_per_million: 4_000_000,
  cache_write_credits_per_million: 1_000_000,
  cache_read_credits_per_million: 80_000,
  effective_until: null,
}

afterEach(() => vi.clearAllMocks())

describe('computeCompletionCredits — never leaks', () => {
  it('priced model: exact credits, no fallback, no audit', async () => {
    const { computeCompletionCredits } = await import('@/lib/cost/completionCredits')
    const r = await computeCompletionCredits(pricingClient(HAIKU), HAIKU.model_id, new Date('2026-06-01'), {
      input: 1_000_000,
      output: 100_000,
    })
    expect(r.usedFallback).toBe(false)
    // 1M*800k/1M + 100k*4M/1M = 800,000 + 400,000
    expect(r.credits).toBe(1_200_000)
    expect(writeAuditLogEntry).not.toHaveBeenCalled()
  })

  it('unpriced model: fallback debit (never null) + CRITICAL audit', async () => {
    const { computeCompletionCredits } = await import('@/lib/cost/completionCredits')
    const r = await computeCompletionCredits(
      pricingClient(null),
      'claude-bogus-9',
      new Date(),
      { input: 1_000_000, output: 1_000_000 },
      { jobId: 'job-1', organisationId: 'org-1' },
    )
    expect(r.usedFallback).toBe(true)
    // fallback 15M in + 75M out: 1M*15M/1M + 1M*75M/1M = 90,000,000
    expect(r.credits).toBe(90_000_000)
    expect(r.credits).not.toBeNull()
    expect(getConfigInt).toHaveBeenCalledWith('pricing.fallback_credits_per_million_input')
    expect(writeAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'unpriced_model_fallback_debit', severity: 'critical' }),
    )
  })

  it('unpriced with zero tokens still returns a number (never null) + audits', async () => {
    const { computeCompletionCredits } = await import('@/lib/cost/completionCredits')
    const r = await computeCompletionCredits(pricingClient(null), 'claude-bogus-9', new Date(), {
      input: 0,
      output: 0,
    })
    expect(typeof r.credits).toBe('number')
    expect(r.credits).toBe(0)
    expect(r.usedFallback).toBe(true)
    expect(writeAuditLogEntry).toHaveBeenCalledTimes(1)
  })
})

describe('checkTokenBudget — fail CLOSED on unpriced model', () => {
  it('refuses dispatch + audits when the model has no pricing row', async () => {
    mockedCreateClient.mockReturnValue(gateClient({ allocation: 1_000_000, usage: 0, pricingRow: null }))
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')
    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      'claude-bogus-9',
    )
    expect(result).toBe(false)
    expect(writeAuditLogEntry).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: 'unpriced_model_dispatch_blocked', severity: 'critical' }),
    )
  })

  it('still admits a priced model within budget (no regression)', async () => {
    mockedCreateClient.mockReturnValue(gateClient({ allocation: 1_000_000, usage: 200_000, pricingRow: HAIKU }))
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')
    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      HAIKU.model_id,
    )
    expect(result).toBe(true)
    expect(writeAuditLogEntry).not.toHaveBeenCalled()
  })
})
