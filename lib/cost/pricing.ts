/**
 * V1.x-C.1 — pricing_rates lookup + cost-credit computation.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §3 C.1 + lib/cost/.
 * Mirrors the SQL `compute_cost_credits` function for unit-test independence
 * (TS impl tested in isolation; SQL impl is the runtime authority for both
 * agent runner + iteration runner per H-20 effective_from race avoidance).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface PricingRate {
  modelId: string
  effectiveFrom: string // ISO date
  inputCreditsPerMillion: number
  outputCreditsPerMillion: number
  cacheWriteCreditsPerMillion: number | null
  cacheReadCreditsPerMillion: number | null
}

export interface TokenUsage {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
}

/**
 * Looks up the active pricing_rates row for a model at a completion timestamp.
 * Returns null if no rate covers that date (caller decides whether to fail
 * loudly or fall back to zero — runner currently logs + writes NULL cost_credits).
 */
export async function lookupRate(
  client: SupabaseClient,
  modelId: string,
  completedAt: Date,
): Promise<PricingRate | null> {
  const completedDate = completedAt.toISOString().slice(0, 10) // YYYY-MM-DD
  const { data, error } = await client
    .from('pricing_rates')
    .select('model_id, effective_from, input_credits_per_million, output_credits_per_million, cache_write_credits_per_million, cache_read_credits_per_million, effective_until')
    .eq('model_id', modelId)
    .lte('effective_from', completedDate)
    .order('effective_from', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  const row = data[0]
  if (row.effective_until !== null && row.effective_until <= completedDate) return null

  return {
    modelId: row.model_id,
    effectiveFrom: row.effective_from,
    inputCreditsPerMillion: Number(row.input_credits_per_million),
    outputCreditsPerMillion: Number(row.output_credits_per_million),
    cacheWriteCreditsPerMillion: row.cache_write_credits_per_million !== null ? Number(row.cache_write_credits_per_million) : null,
    cacheReadCreditsPerMillion: row.cache_read_credits_per_million !== null ? Number(row.cache_read_credits_per_million) : null,
  }
}

/**
 * Pure compute. Mirrors SQL compute_cost_credits exactly so the parity test
 * (CK-2) can compare TS vs SQL on a randomised input matrix.
 */
export function computeCostCredits(rate: PricingRate, usage: TokenUsage): number {
  const inputRate = rate.inputCreditsPerMillion
  const outputRate = rate.outputCreditsPerMillion
  const cacheWriteRate = rate.cacheWriteCreditsPerMillion ?? inputRate
  const cacheReadRate = rate.cacheReadCreditsPerMillion ?? inputRate

  return (
    (usage.input * inputRate) / 1_000_000 +
    (usage.output * outputRate) / 1_000_000 +
    ((usage.cacheWrite ?? 0) * cacheWriteRate) / 1_000_000 +
    ((usage.cacheRead ?? 0) * cacheReadRate) / 1_000_000
  )
}

/**
 * One-shot helper used by runners at completion time. Returns null if the
 * rate lookup fails so callers can write NULL cost_credits + emit a metric.
 */
export async function computeJobCostCredits(
  client: SupabaseClient,
  modelId: string,
  completedAt: Date,
  usage: TokenUsage,
): Promise<number | null> {
  const rate = await lookupRate(client, modelId, completedAt)
  if (!rate) return null
  return computeCostCredits(rate, usage)
}
