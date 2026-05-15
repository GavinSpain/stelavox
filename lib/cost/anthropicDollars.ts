/**
 * V1.x-C.1 — anthropic_pricing lookup + $-cost computation for BYOK.
 *
 * Source: stelavox_v1x_c_build_checklist_v1_0.md §3 C.1 + lib/cost/.
 * Same shape as lib/cost/pricing.ts but returns dollars, not credits.
 * BYOK users see real Anthropic dollars on the cost meter.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface AnthropicRate {
  modelId: string
  effectiveFrom: string
  inputDollarsPerMillion: number
  outputDollarsPerMillion: number
  cacheWriteDollarsPerMillion: number | null
  cacheReadDollarsPerMillion: number | null
}

export interface TokenUsage {
  input: number
  output: number
  cacheWrite?: number
  cacheRead?: number
}

export async function lookupAnthropicRate(
  client: SupabaseClient,
  modelId: string,
  completedAt: Date,
): Promise<AnthropicRate | null> {
  const completedDate = completedAt.toISOString().slice(0, 10)
  const { data, error } = await client
    .from('anthropic_pricing')
    .select('model_id, effective_from, input_dollars_per_million, output_dollars_per_million, cache_write_dollars_per_million, cache_read_dollars_per_million, effective_until')
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
    inputDollarsPerMillion: Number(row.input_dollars_per_million),
    outputDollarsPerMillion: Number(row.output_dollars_per_million),
    cacheWriteDollarsPerMillion: row.cache_write_dollars_per_million !== null ? Number(row.cache_write_dollars_per_million) : null,
    cacheReadDollarsPerMillion: row.cache_read_dollars_per_million !== null ? Number(row.cache_read_dollars_per_million) : null,
  }
}

export function computeAnthropicDollars(rate: AnthropicRate, usage: TokenUsage): number {
  const inputRate = rate.inputDollarsPerMillion
  const outputRate = rate.outputDollarsPerMillion
  const cacheWriteRate = rate.cacheWriteDollarsPerMillion ?? inputRate
  const cacheReadRate = rate.cacheReadDollarsPerMillion ?? inputRate

  return (
    (usage.input * inputRate) / 1_000_000 +
    (usage.output * outputRate) / 1_000_000 +
    ((usage.cacheWrite ?? 0) * cacheWriteRate) / 1_000_000 +
    ((usage.cacheRead ?? 0) * cacheReadRate) / 1_000_000
  )
}

export async function computeJobAnthropicDollars(
  client: SupabaseClient,
  modelId: string,
  completedAt: Date,
  usage: TokenUsage,
): Promise<number | null> {
  const rate = await lookupAnthropicRate(client, modelId, completedAt)
  if (!rate) return null
  return computeAnthropicDollars(rate, usage)
}
