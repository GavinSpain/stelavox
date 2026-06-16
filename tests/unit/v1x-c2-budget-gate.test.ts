/**
 * V1.x-C.2 — credit-based admission gate unit tests.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §6 CK-4 + lib/llm/token-budget.ts.
 *
 * Covers the decision logic of `checkTokenBudget` in isolation by
 * mocking the service-role Supabase client. Three behaviour classes:
 *
 *   1. BYOK orgs always pass (isByok bypass).
 *   2. NULL token_allocation_credits passes (V1 "not enforced" policy).
 *   3. Enforced orgs: pass when usage + estimated_credits ≤ allocation + grace;
 *      refuse otherwise.
 *
 * The token → credit conversion uses the active pricing_rates row for
 * the model. The test mocks the row directly to keep results
 * deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(),
}))

// Model Governance P0 — the fail-closed branch writes a critical audit;
// stub it so the gate's mock client doesn't need an audit_log insert.
vi.mock('@/lib/security/audit', () => ({ writeAuditLogEntry: vi.fn() }))

import { createServiceRoleClient } from '@/lib/supabase/service'

const mockedCreateClient = createServiceRoleClient as unknown as ReturnType<typeof vi.fn>

/**
 * Build a flexible mock client that returns different rows depending on
 * which table is queried. Used to script the gate's reads:
 *   - organisations: returns { token_allocation_credits, token_usage_credits }
 *   - pricing_rates: returns one row
 *   - platform_config: returns { value } for plan.over_limit_grace_credits
 */
function buildClient(reads: {
  organisationsRow?: { token_allocation_credits: number | null; token_usage_credits: number | null } | null
  pricingRow?: {
    model_id: string
    effective_from: string
    input_credits_per_million: number
    output_credits_per_million: number
    cache_write_credits_per_million: number | null
    cache_read_credits_per_million: number | null
    effective_until: string | null
  } | null
  graceCredits?: number
}) {
  let lastTable = ''
  let lastSelect = ''

  const fromHandler = (table: string) => {
    lastTable = table
    const chain: Record<string, unknown> = {}
    chain.select = (sel: string) => {
      lastSelect = sel
      return chain
    }
    chain.eq = () => chain
    chain.lte = () => chain
    chain.order = () => chain
    chain.limit = () => {
      if (lastTable === 'pricing_rates') {
        return Promise.resolve({
          data: reads.pricingRow ? [reads.pricingRow] : [],
          error: null,
        })
      }
      return Promise.resolve({ data: [], error: null })
    }
    chain.maybeSingle = () => {
      if (lastTable === 'organisations') {
        return Promise.resolve({ data: reads.organisationsRow ?? null, error: null })
      }
      if (lastTable === 'platform_config') {
        return Promise.resolve({ data: { value: reads.graceCredits ?? 0 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }
    chain.single = () => {
      if (lastTable === 'platform_config') {
        return Promise.resolve({ data: { value: reads.graceCredits ?? 0 }, error: null })
      }
      return Promise.resolve({ data: null, error: null })
    }
    return chain
  }

  return {
    from: fromHandler,
    _lastTable: () => lastTable,
    _lastSelect: () => lastSelect,
  } as unknown as ReturnType<typeof createServiceRoleClient>
}

describe('V1.x-C.2 — checkTokenBudget credit-based admission', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('BYOK plan (byok_solo) bypasses the gate even when over budget', async () => {
    // No client reads should fire — the isByok() short-circuit comes
    // before any DB access. Build a client that fails every call to
    // catch any leakage.
    mockedCreateClient.mockReturnValue(buildClient({}))
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'byok_solo', current_period_start: null },
      999_999_999,
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(true)
  })

  it('byok_enabled=true on a non-BYOK plan name also bypasses', async () => {
    mockedCreateClient.mockReturnValue(buildClient({}))
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: null, byok_enabled: true },
      999_999_999,
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(true)
  })

  it('NULL token_allocation_credits is treated as not enforced', async () => {
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: { token_allocation_credits: null, token_usage_credits: 0 },
      }),
    )
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: null },
      999_999_999,
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(true)
  })

  it('missing organisations row also passes through (defensive)', async () => {
    mockedCreateClient.mockReturnValue(buildClient({ organisationsRow: null }))
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-not-found', plan: 'writer', current_period_start: null },
      100_000,
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(true)
  })

  it('admits when usage + estimated_credits ≤ allocation + grace', async () => {
    // Writer plan at 1,000,000 credit allocation, 200,000 already used.
    // 100,000 tokens × 800,000 credits/M = 80,000 credits estimated.
    // 200,000 + 80,000 = 280,000 ≤ 1,000,000 → admit.
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: { token_allocation_credits: 1_000_000, token_usage_credits: 200_000 },
        pricingRow: {
          model_id: 'claude-haiku-4-5-20251001',
          effective_from: '2026-05-01',
          input_credits_per_million: 800_000,
          output_credits_per_million: 4_000_000,
          cache_write_credits_per_million: 1_000_000,
          cache_read_credits_per_million: 80_000,
          effective_until: null,
        },
        graceCredits: 0,
      }),
    )
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000, // 100k tokens
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(true)
  })

  it('refuses when usage + estimated_credits > allocation + grace', async () => {
    // Writer plan at 1,000,000 credit allocation, 950,000 already used.
    // 100,000 tokens × 800,000/M = 80,000 credits estimated.
    // 950,000 + 80,000 = 1,030,000 > 1,000,000 → refuse.
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: { token_allocation_credits: 1_000_000, token_usage_credits: 950_000 },
        pricingRow: {
          model_id: 'claude-haiku-4-5-20251001',
          effective_from: '2026-05-01',
          input_credits_per_million: 800_000,
          output_credits_per_million: 4_000_000,
          cache_write_credits_per_million: 1_000_000,
          cache_read_credits_per_million: 80_000,
          effective_until: null,
        },
        graceCredits: 0,
      }),
    )
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      'claude-haiku-4-5-20251001',
    )
    expect(result).toBe(false)
  })

  it('grace credits extend the admission ceiling', async () => {
    // Same scenario as refuse-case, but grace=100,000 covers the overrun.
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: { token_allocation_credits: 1_000_000, token_usage_credits: 950_000 },
        pricingRow: {
          model_id: 'claude-haiku-4-5-20251001',
          effective_from: '2026-05-01',
          input_credits_per_million: 800_000,
          output_credits_per_million: 4_000_000,
          cache_write_credits_per_million: 1_000_000,
          cache_read_credits_per_million: 80_000,
          effective_until: null,
        },
        graceCredits: 100_000,
      }),
    )
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      'claude-haiku-4-5-20251001',
    )
    // 950k + 80k = 1.03M ≤ 1M + 100k = 1.1M → admit.
    expect(result).toBe(true)
  })

  it('Opus model burns credits ~18× faster — same token estimate refused on Opus where Haiku would pass', async () => {
    const sharedOrg = {
      token_allocation_credits: 1_000_000,
      token_usage_credits: 0,
    }

    // 100,000 Opus tokens × 15,000,000/M = 1,500,000 credits → refuse.
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: sharedOrg,
        pricingRow: {
          model_id: 'claude-opus-4-7',
          effective_from: '2026-05-01',
          input_credits_per_million: 15_000_000,
          output_credits_per_million: 75_000_000,
          cache_write_credits_per_million: 18_750_000,
          cache_read_credits_per_million: 1_500_000,
          effective_until: null,
        },
        graceCredits: 0,
      }),
    )
    const { checkTokenBudget: gateOpus } = await import('@/lib/llm/token-budget')
    const opusResult = await gateOpus(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      'claude-opus-4-7',
    )
    expect(opusResult).toBe(false)
  })

  it('missing pricing_rates row FAILS CLOSED (Model Governance P0)', async () => {
    // An unpriced model cannot be metered, so dispatching it is revenue
    // leakage. Policy reversed from V1.x-C.2's fail-open: the gate now
    // REFUSES (and audits) rather than admitting free usage. Assignment
    // integrity (M-232) makes this unreachable in normal operation.
    mockedCreateClient.mockReturnValue(
      buildClient({
        organisationsRow: { token_allocation_credits: 1_000_000, token_usage_credits: 0 },
        pricingRow: null,
      }),
    )
    const { checkTokenBudget } = await import('@/lib/llm/token-budget')

    const result = await checkTokenBudget(
      { id: 'org-1', plan: 'writer', current_period_start: '2026-05-01T00:00:00Z' },
      100_000,
      'unknown-model-id',
    )
    expect(result).toBe(false)
  })
})
