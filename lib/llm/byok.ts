/**
 * BYOK (Bring Your Own Key) detection — single source of truth.
 *
 * Round-3 audit B6.3 / F-19: pre-fix `lib/llm/token-budget.ts` inspected
 * `org.plan === 'byok_solo' | 'byok_team'` while `lib/llm/factory.ts`
 * inspected `org.byok_enabled` (a boolean column). The two sources
 * could disagree silently — a `byok_enterprise` plan added later
 * wouldn't bypass the budget gate; a non-BYOK plan with
 * `byok_enabled=true` would.
 *
 * This helper centralises the check. Both columns are evaluated; an
 * organisation is BYOK iff EITHER signal indicates BYOK. That gives
 * the most permissive answer and avoids accidentally double-charging
 * a BYOK customer because two columns disagreed.
 *
 * V1 has no BYOK plans (the `byok_solo` / `byok_team` plan strings are
 * defensive future-compat). V2 lights up the byok_enabled column and
 * the full Vercel-AI-SDK BYOK path.
 */

interface ByokSignals {
  plan?: string | null
  byok_enabled?: boolean | null
}

/** Recognised BYOK plan slugs (V1: defensive; V2: real). */
const BYOK_PLAN_NAMES = new Set(['byok_solo', 'byok_team', 'byok_enterprise'])

/**
 * Returns true iff the organisation is on a BYOK plan.
 *
 * Sources consulted (in priority order):
 *   1. byok_enabled = true  → BYOK
 *   2. plan in BYOK_PLAN_NAMES → BYOK
 * Otherwise → not BYOK.
 *
 * Both signals are evaluated so a misconfigured row (one column saying
 * BYOK and the other not) is treated as BYOK. The audit's concern was
 * that the two checks could DISAGREE; this helper makes that impossible
 * for callers because they all flow through the single function.
 */
export function isByok(org: ByokSignals): boolean {
  if (org.byok_enabled === true) return true
  if (typeof org.plan === 'string' && BYOK_PLAN_NAMES.has(org.plan)) return true
  return false
}
