/**
 * Token budget gate.
 *
 * Source: stelavox_technical_architecture_v1_8.md §7.5 + H-07.
 * Build Checklist T-2.5.
 *
 * Called by every agent operation API route BEFORE creating the agent_jobs
 * row. Per H-07: "If the budget check runs inside the Edge Function after
 * the agent job record has been created, a budget-exceeded failure leaves
 * an orphaned agent_job record in pending status."
 *
 * Returns true if the operation can proceed; false if it would exceed budget.
 * BYOK plans bypass the gate entirely (V1 has no BYOK plans — defensive
 * future-compat check).
 *
 * Failure → 402 token_budget_exceeded from the API route; no agent_jobs
 * row is created.
 */

import 'server-only'

import { getConfigInt } from '@/lib/config/platform-config'
import { createServiceRoleClient } from '@/lib/supabase/service'

/** Subset of organisations row needed by the gate. */
export interface BudgetCheckOrg {
  id: string
  plan: string
  current_period_start: string | null
}

/**
 * Check whether `estimatedTokens` more tokens fit in the org's current period
 * budget. Returns true if OK, false if over budget.
 *
 * Reads token_budget.<plan> from platform_config and the org's accumulated
 * usage from usage_records WHERE period_start = org.current_period_start.
 */
export async function checkTokenBudget(
  organisation: BudgetCheckOrg,
  estimatedTokens: number,
): Promise<boolean> {
  // BYOK plans bypass — V2 work; V1 has no BYOK plans, defensive.
  if (organisation.plan === 'byok_solo' || organisation.plan === 'byok_team') {
    return true
  }

  const budget = await getConfigInt(`token_budget.${organisation.plan}`)
  const used = await getPeriodTokens(organisation.id, organisation.current_period_start)
  return used + estimatedTokens <= budget
}

/**
 * Sum tokens consumed by the org during the current billing period.
 * usage_records keys by year_month (TEXT, e.g. "2026-05"), one row per
 * (org, year_month, operation_type, provider). Sum across all matching
 * rows for the current period.
 *
 * Returns 0 if no usage_records rows exist (e.g. brand-new org).
 */
async function getPeriodTokens(
  organisationId: string,
  periodStart: string | null,
): Promise<number> {
  if (!periodStart) return 0
  const yearMonth = formatYearMonth(periodStart)
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('usage_records')
    .select('tokens_input, tokens_output')
    .eq('organisation_id', organisationId)
    .eq('year_month', yearMonth)

  if (error) {
    throw new Error(`Failed to query usage_records: ${error.message}`)
  }

  return (data ?? []).reduce(
    (sum, row) => sum + (row.tokens_input ?? 0) + (row.tokens_output ?? 0),
    0,
  )
}

/** Convert a TIMESTAMPTZ-shaped string (e.g. "2026-05-15T00:00:00Z") to "2026-05". */
function formatYearMonth(periodStart: string): string {
  const d = new Date(periodStart)
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}
