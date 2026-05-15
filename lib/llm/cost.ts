/**
 * Cost computation for agent operations.
 *
 * V1.x-C.1.b (2026-05-17): the rate source moved from `platform_config`
 * keys (`price.anthropic.<model>.input_per_mtok` / `output_per_mtok`) to
 * the time-versioned `anthropic_pricing` table (M-132). The function
 * signature is preserved so existing callers (`lib/agent/runner.ts`,
 * `lib/director/iteration-runner.ts`) keep working unchanged. Cache
 * pricing is now read directly from the per-row `cache_write_*` /
 * `cache_read_*` columns rather than the prior 1.25× / 0.10× multiplier
 * convention — the seeded rates already encode that ratio, so output
 * matches the old implementation byte-for-byte for the seeded models.
 *
 * Throws if no `anthropic_pricing` row covers the model at "today" — the
 * V1.x-C.1.a seed populates all V1 supported models (Haiku 4.5, Sonnet
 * 4.6, Opus 4.7), so an unseeded model_id is a real misconfig (matches
 * the original fail-fast behaviour against platform_config).
 *
 * The result is written to `agent_jobs.cost_usd` as DECIMAL(10,6) and
 * frozen at job-completion time. Historical rows show the cost as it was
 * on the day the operation ran — H-20 mitigation via completed_at date
 * keying.
 *
 * Internal-only field — not surfaced in V1 user-facing UI per Component
 * Spec §5.9 / Product Spec §3.2 (platform users see allocation %, BYOK
 * users see raw token counts, no dollar amounts displayed). V1.x-C.2 +
 * V1.x-C.3 light up the user-facing cost meter.
 */

import 'server-only'

import { computeJobAnthropicDollars } from '@/lib/cost/anthropicDollars'
import type { TokenUsage } from '@/lib/llm/types'
import { createServiceRoleClient } from '@/lib/supabase/service'

/**
 * Compute USD cost for a token usage record against a specific model.
 * Reads from the `anthropic_pricing` table at "now" — completed_at is
 * always the current moment because runners call this at the point of
 * writing the row.
 */
export async function computeCostUsd(
  usage: TokenUsage,
  modelId: string,
): Promise<number> {
  const supabase = createServiceRoleClient()
  const dollars = await computeJobAnthropicDollars(
    supabase,
    modelId,
    new Date(),
    {
      input: usage.tokens_input,
      output: usage.tokens_output,
      cacheWrite: usage.tokens_cache_write,
      cacheRead: usage.tokens_cache_read,
    },
  )
  if (dollars === null) {
    throw new Error(`anthropic_pricing_rate_missing:${modelId}`)
  }
  return dollars
}
