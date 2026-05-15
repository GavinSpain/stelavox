/**
 * Token budget gate — V1.x-C.2 credit-based admission.
 *
 * Source: stelavox_technical_architecture §7.5 + H-07; rewritten for
 * V1.x-C.2 against `stelavox_v1x_c_build_checklist_v1_0.md` §3 C.2.
 *
 * Called by every agent operation API route + the Director message
 * route BEFORE creating any agent_jobs row. Per H-07: "If the budget
 * check runs inside the Edge Function after the agent job record has
 * been created, a budget-exceeded failure leaves an orphaned agent_job
 * record in pending status."
 *
 * V1.x-C.2 behavioural change:
 * - Source of truth moved from `platform_config.token_budget.<plan>`
 *   (raw tokens) to `organisations.token_allocation_credits` (credits)
 *   + `organisations.token_usage_credits` (running counter incremented
 *   atomically by M-135 trigger on agent_jobs.cost_credits transitions).
 * - The gate signature gains a `modelId: string` param. Callers continue
 *   passing their token estimate (`profile.max_tokens + headroom` for
 *   agent ops; `agent.director_estimated_tokens_per_turn` for Director).
 *   The gate converts tokens → credits using the active `pricing_rates`
 *   row for `modelId` (input-credits-per-million as the upper bound,
 *   treating the whole estimate as input — conservative; admission-safe
 *   for output-heavy operations because output credits are >= input).
 *
 * BYOK organisations bypass the gate entirely via `isByok()` (BYOK plans
 * pay Anthropic directly; the platform does not enforce credit budget on
 * BYOK). NULL `token_allocation_credits` is treated as "not enforced" —
 * covers BYOK rows that didn't get backfilled, and any non-V1 plan slug.
 *
 * Returns `true` if the operation can proceed; `false` if it would
 * exceed budget. Failure → 402 `token_budget_exceeded` from the API
 * route; no agent_jobs row is created.
 */

import 'server-only'

import { getConfigInt } from '@/lib/config/platform-config'
import { lookupRate } from '@/lib/cost/pricing'
import { isByok } from '@/lib/llm/byok'
import { createServiceRoleClient } from '@/lib/supabase/service'

/** Subset of organisations row read by the gate. */
export interface BudgetCheckOrg {
  id: string
  plan: string
  current_period_start: string | null
  byok_enabled?: boolean | null
}

/**
 * V1.x-C.2 — credit-based admission gate.
 *
 * `estimatedTokens` is the caller's token budget estimate (existing
 * contract). `modelId` is the model the dispatched job will run against
 * — used to look up the pricing_rates row and convert the token estimate
 * to a credit estimate.
 *
 * Returns true iff the org's accumulated usage + estimated credits stays
 * within `token_allocation_credits + plan.over_limit_grace_credits`.
 */
export async function checkTokenBudget(
  organisation: BudgetCheckOrg,
  estimatedTokens: number,
  modelId: string,
): Promise<boolean> {
  // BYOK organisations bypass the platform credit budget entirely.
  if (isByok(organisation)) {
    return true
  }

  const supabase = createServiceRoleClient()

  const { data: orgRow, error: orgErr } = await supabase
    .from('organisations')
    .select('token_allocation_credits, token_usage_credits')
    .eq('id', organisation.id)
    .maybeSingle()

  if (orgErr) {
    throw new Error(`Failed to read organisations credit columns: ${orgErr.message}`)
  }
  // NULL allocation = not enforced. Covers BYOK plans whose isByok()
  // bypass somehow didn't fire (defence-in-depth) plus any non-V1 plan
  // slug. Allowing dispatch on NULL is the safe default — V1.x-C.2 ships
  // strict enforcement for the four locked plan slugs and treats anything
  // else as not-yet-priced.
  if (!orgRow || orgRow.token_allocation_credits === null) {
    return true
  }

  const allocationCredits = Number(orgRow.token_allocation_credits)
  const usageCredits = Number(orgRow.token_usage_credits ?? 0)

  // Convert the caller's token estimate into a credit estimate using the
  // active pricing_rates row for `modelId`. Treat the entire estimate as
  // input tokens — output_credits_per_million is always >= input rate at
  // the seeded values, so an "all input" estimate is the conservative
  // lower bound on credit cost; using it here means the gate admits
  // jobs the actual cost might still under-spend, which is safe (any
  // over-spend is caught by the post-completion usage trigger that
  // increments token_usage_credits, so subsequent jobs are refused
  // earlier).
  const rate = await lookupRate(supabase, modelId, new Date())
  if (!rate) {
    // No pricing row for this model. Falling back to "not enforced" is
    // the consistent V1.x-C.2 policy — admission gate's job is to
    // prevent runaway spend on KNOWN-priced models. Unknown-priced
    // models are flagged at completion-write time (where cost_credits
    // ends up NULL and the usage trigger does not fire).
    console.warn(
      `[token-budget] no pricing_rates row for model ${modelId}; skipping credit gate.`,
    )
    return true
  }

  const estimatedCredits = (estimatedTokens * rate.inputCreditsPerMillion) / 1_000_000

  const graceCredits = await getConfigInt('plan.over_limit_grace_credits')

  return usageCredits + estimatedCredits <= allocationCredits + graceCredits
}
