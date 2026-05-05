/**
 * Cost computation for agent operations.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §5 G-13. Build Checklist T-2.6.
 *
 * Pure function called by the Edge Function at job completion. Reads
 * input/output prices from platform_config; cache pricing is derived as
 * Anthropic-published multipliers (cache_write = 1.25× input,
 * cache_read = 0.10× input — these are platform-of-Anthropic constants,
 * not Stelavox tunables).
 *
 * The result is written to agent_jobs.cost_usd as DECIMAL(10,6) and frozen
 * at job-completion time. Historical rows show the cost as it was on the
 * day the operation ran — insulated from later Anthropic price changes.
 *
 * Internal-only field — not surfaced in V1 user-facing UI per Component
 * Spec §5.9 / Product Spec §3.2 (platform users see allocation %, BYOK
 * users see raw token counts, no dollar amounts displayed).
 */

import 'server-only'

import { getConfigNumber } from '@/lib/config/platform-config'
import type { TokenUsage } from '@/lib/llm/types'

const CACHE_WRITE_MULTIPLIER = 1.25 // Anthropic pricing: cache_write = 1.25 × input
const CACHE_READ_MULTIPLIER = 0.10 // Anthropic pricing: cache_read = 0.10 × input

/**
 * Compute USD cost for a token usage record against a specific model.
 * Throws if the model's price keys are missing from platform_config —
 * Phase 5 fails fast on misconfiguration rather than silently miscount.
 */
export async function computeCostUsd(
  usage: TokenUsage,
  modelId: string,
): Promise<number> {
  const inputPrice = await getConfigNumber(`price.anthropic.${modelId}.input_per_mtok`)
  const outputPrice = await getConfigNumber(`price.anthropic.${modelId}.output_per_mtok`)

  return (
    (usage.tokens_input / 1_000_000) * inputPrice +
    (usage.tokens_output / 1_000_000) * outputPrice +
    (usage.tokens_cache_write / 1_000_000) * inputPrice * CACHE_WRITE_MULTIPLIER +
    (usage.tokens_cache_read / 1_000_000) * inputPrice * CACHE_READ_MULTIPLIER
  )
}
