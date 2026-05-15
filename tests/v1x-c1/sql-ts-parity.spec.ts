/**
 * V1.x-C.1 — CK-1 + CK-2 SQL ↔ TS parity integration tests.
 *
 * Compares the Postgres `compute_cost_credits` SQL function to the TS
 * `computeCostCredits` helper across a randomised input matrix. Same for
 * `compute_anthropic_dollars` ↔ `computeAnthropicDollars`.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §6 + lib/cost/.
 */

import { test, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

import { computeAnthropicDollars, lookupAnthropicRate } from '@/lib/cost/anthropicDollars'
import { computeCostCredits, lookupRate } from '@/lib/cost/pricing'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
}

const MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7']

test.describe('V1.x-C.1 — pricing substrate', () => {
  test('CK-1: lookupRate returns the active row at completion date', async () => {
    const c = adminClient()
    const now = new Date()
    for (const model of MODELS) {
      const rate = await lookupRate(c, model, now)
      expect(rate).not.toBeNull()
      expect(rate!.modelId).toBe(model)
      expect(rate!.inputCreditsPerMillion).toBeGreaterThan(0)
      expect(rate!.outputCreditsPerMillion).toBeGreaterThan(0)
    }
  })

  test('CK-1: lookupRate returns null for unknown model', async () => {
    const c = adminClient()
    const rate = await lookupRate(c, 'claude-bogus-9-9', new Date())
    expect(rate).toBeNull()
  })

  test('CK-1: lookupRate returns null for date before any effective_from', async () => {
    const c = adminClient()
    const ancient = new Date('2020-01-01T00:00:00Z')
    const rate = await lookupRate(c, MODELS[0], ancient)
    expect(rate).toBeNull()
  })

  test('CK-2: TS computeCostCredits matches SQL compute_cost_credits across randomised inputs', async () => {
    const c = adminClient()
    const completedAt = new Date()

    // 20 randomised cases × 3 models = 60 parity assertions.
    for (const model of MODELS) {
      const tsRate = await lookupRate(c, model, completedAt)
      expect(tsRate).not.toBeNull()

      for (let i = 0; i < 20; i++) {
        const tokensInput = Math.floor(Math.random() * 200_000)
        const tokensOutput = Math.floor(Math.random() * 50_000)
        const cacheWrite = Math.floor(Math.random() * 10_000)
        const cacheRead = Math.floor(Math.random() * 100_000)

        const tsCredits = computeCostCredits(tsRate!, {
          input: tokensInput,
          output: tokensOutput,
          cacheWrite,
          cacheRead,
        })

        const { data: sqlResult, error } = await c.rpc('compute_cost_credits', {
          p_model_id: model,
          p_completed_at: completedAt.toISOString(),
          p_tokens_input: tokensInput,
          p_tokens_output: tokensOutput,
          p_cache_write: cacheWrite,
          p_cache_read: cacheRead,
        })
        expect(error).toBeNull()
        expect(Number(sqlResult)).toBeCloseTo(tsCredits, 2)
      }
    }
  })

  test('CK-2: TS computeAnthropicDollars matches SQL compute_anthropic_dollars', async () => {
    const c = adminClient()
    const completedAt = new Date()

    for (const model of MODELS) {
      const tsRate = await lookupAnthropicRate(c, model, completedAt)
      expect(tsRate).not.toBeNull()

      for (let i = 0; i < 10; i++) {
        const tokensInput = Math.floor(Math.random() * 100_000)
        const tokensOutput = Math.floor(Math.random() * 25_000)

        const tsDollars = computeAnthropicDollars(tsRate!, {
          input: tokensInput,
          output: tokensOutput,
        })

        const { data: sqlResult, error } = await c.rpc('compute_anthropic_dollars', {
          p_model_id: model,
          p_completed_at: completedAt.toISOString(),
          p_tokens_input: tokensInput,
          p_tokens_output: tokensOutput,
        })
        expect(error).toBeNull()
        expect(Number(sqlResult)).toBeCloseTo(tsDollars, 4)
      }
    }
  })
})
