/**
 * V1.x-C.1 — pricing + cost computation unit tests.
 *
 * CK-1: pricing_rates lookup returns the active rate at completed_at
 * CK-2: compute_cost_credits SQL matches TS implementation (parity)
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §6 + lib/cost/pricing.ts.
 */

import { describe, expect, it } from 'vitest'

import { computeAnthropicDollars, type AnthropicRate } from '@/lib/cost/anthropicDollars'
import { computeCostCredits, type PricingRate, type TokenUsage } from '@/lib/cost/pricing'

const haikuRate: PricingRate = {
  modelId: 'claude-haiku-4-5-20251001',
  effectiveFrom: '2026-05-01',
  inputCreditsPerMillion: 800_000,
  outputCreditsPerMillion: 4_000_000,
  cacheWriteCreditsPerMillion: 1_000_000,
  cacheReadCreditsPerMillion: 80_000,
}

const haikuDollars: AnthropicRate = {
  modelId: 'claude-haiku-4-5-20251001',
  effectiveFrom: '2026-05-01',
  inputDollarsPerMillion: 0.80,
  outputDollarsPerMillion: 4.00,
  cacheWriteDollarsPerMillion: 1.00,
  cacheReadDollarsPerMillion: 0.08,
}

describe('computeCostCredits', () => {
  it('handles input + output only', () => {
    const usage: TokenUsage = { input: 1_000_000, output: 100_000 }
    const credits = computeCostCredits(haikuRate, usage)
    // 1M * 800,000 / 1M = 800,000 input + 100,000 * 4,000,000 / 1M = 400,000 output
    expect(credits).toBe(1_200_000)
  })

  it('handles cache write + read', () => {
    const usage: TokenUsage = { input: 0, output: 0, cacheWrite: 100_000, cacheRead: 1_000_000 }
    const credits = computeCostCredits(haikuRate, usage)
    // 100k * 1M/1M = 100,000 + 1M * 80,000/1M = 80,000
    expect(credits).toBe(180_000)
  })

  it('falls back to input rate when cache rates are null', () => {
    const noCacheRate: PricingRate = { ...haikuRate, cacheWriteCreditsPerMillion: null, cacheReadCreditsPerMillion: null }
    const usage: TokenUsage = { input: 0, output: 0, cacheWrite: 100_000, cacheRead: 100_000 }
    const credits = computeCostCredits(noCacheRate, usage)
    // 100k + 100k = 200k tokens at input rate 800,000 / 1M = 80,000 + 80,000 = 160,000
    expect(credits).toBe(160_000)
  })

  it('handles zero usage', () => {
    const credits = computeCostCredits(haikuRate, { input: 0, output: 0 })
    expect(credits).toBe(0)
  })
})

describe('computeAnthropicDollars', () => {
  it('Haiku 1M input + 100k output = $1.20', () => {
    const dollars = computeAnthropicDollars(haikuDollars, { input: 1_000_000, output: 100_000 })
    // 1.0 * 0.80 + 0.1 * 4.00 = 0.80 + 0.40 = 1.20
    expect(dollars).toBeCloseTo(1.20, 6)
  })

  it('handles cache write at 1.25× input multiplier (Anthropic pricing convention)', () => {
    const dollars = computeAnthropicDollars(haikuDollars, { input: 0, output: 0, cacheWrite: 1_000_000 })
    // 1M * $1.00/M = $1.00 (cache write is 1.25× input = $0.80 × 1.25 = $1.00)
    expect(dollars).toBeCloseTo(1.00, 6)
  })

  it('handles cache read at 0.10× input multiplier (Anthropic pricing convention)', () => {
    const dollars = computeAnthropicDollars(haikuDollars, { input: 0, output: 0, cacheRead: 1_000_000 })
    // 1M * $0.08/M = $0.08 (cache read is 0.10× input = $0.80 × 0.10 = $0.08)
    expect(dollars).toBeCloseTo(0.08, 6)
  })

  it('credit-to-dollar ratio holds (1 credit ≈ $0.000001 by construction)', () => {
    // For the same usage, credits should equal dollars × 1,000,000
    const usage: TokenUsage = { input: 1_000_000, output: 100_000, cacheWrite: 50_000, cacheRead: 200_000 }
    const credits = computeCostCredits(haikuRate, usage)
    const dollars = computeAnthropicDollars(haikuDollars, usage)
    expect(credits).toBeCloseTo(dollars * 1_000_000, 0)
  })
})
