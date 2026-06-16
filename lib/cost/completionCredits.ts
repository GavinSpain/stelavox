/**
 * Model Governance P0 — guaranteed-non-null credit computation at completion.
 *
 * The leak this closes: previously, a completed job whose model lacked a
 * pricing row wrote `cost_credits = NULL`, the accumulate trigger never
 * fired, and the usage was FREE (Anthropic still billed the platform).
 *
 * `computeCompletionCredits` NEVER returns null:
 *   - model priced  → exact credits (pricing_rates view of anthropic_pricing)
 *   - model unpriced → debit at the conservative-high fallback rate (M-233
 *     config), write a CRITICAL audit_log row, and flag usedFallback.
 *
 * Given assignment integrity (M-232) an unpriced completion should be
 * impossible; this is the belt-and-braces so a pricing row expiring between
 * dispatch and completion can never become silent leakage.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { getConfigInt } from '@/lib/config/platform-config'
import { computeCostCredits, lookupRate, type TokenUsage } from '@/lib/cost/pricing'
import { writeAuditLogEntry } from '@/lib/security/audit'

export interface CompletionCredits {
  /** Always a real number — never null. */
  credits: number
  /** True when the conservative fallback rate was used (a should-never-happen state). */
  usedFallback: boolean
}

export async function computeCompletionCredits(
  client: SupabaseClient,
  modelId: string,
  completedAt: Date,
  usage: TokenUsage,
  ctx?: { jobId?: string | null; organisationId?: string | null },
): Promise<CompletionCredits> {
  const rate = await lookupRate(client, modelId, completedAt)
  if (rate) {
    return { credits: computeCostCredits(rate, usage), usedFallback: false }
  }

  // No current pricing row — debit conservatively rather than leak.
  const [inFb, outFb] = await Promise.all([
    getConfigInt('pricing.fallback_credits_per_million_input'),
    getConfigInt('pricing.fallback_credits_per_million_output'),
  ])
  const credits =
    (usage.input * inFb +
      usage.output * outFb +
      (usage.cacheWrite ?? 0) * inFb +
      (usage.cacheRead ?? 0) * inFb) /
    1_000_000

  // Fire-and-forget critical audit; never blocks the debit.
  await writeAuditLogEntry({
    event_type: 'unpriced_model_fallback_debit',
    severity: 'critical',
    organisation_id: ctx?.organisationId ?? null,
    metadata: {
      model_id: modelId,
      job_id: ctx?.jobId ?? null,
      fallback_credits: credits,
      tokens_input: usage.input,
      tokens_output: usage.output,
      note: 'Model had no current pricing row at completion. Debited at the fallback rate to avoid leakage. Assignment integrity (M-232) should make this impossible — investigate.',
    },
  })

  return { credits, usedFallback: true }
}
