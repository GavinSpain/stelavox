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
 *
 * V1.x-B.1.2: the per-org BYOK columns (`organisations.byok_*`) remain
 * the V2 path. The V1.x-B.1.2 BYOK substrate uses per-user keys via
 * `userHasByokKey()` below; per-org columns are left in place but
 * unused (V2 deprecation candidate). Both checks coexist for now.
 */
export function isByok(org: ByokSignals): boolean {
  if (org.byok_enabled === true) return true
  if (typeof org.plan === 'string' && BYOK_PLAN_NAMES.has(org.plan)) return true
  return false
}

/**
 * V1.x-B.1.2 — does this user have a BYOK key on file?
 *
 * Wraps `get_user_anthropic_key_status` RPC. Read-only — never returns
 * the key value. Used by `lib/llm/factory.ts` to decide whether to
 * route via the BYOK Edge Function or via the platform AnthropicProvider.
 *
 * Caller passes a Supabase service-role client (so we can read any
 * user's status from server-side dispatch paths). The RPC itself is
 * authenticated-only; for service-role callers we use a small bypass
 * pattern: check user_anthropic_keys directly via a service-role SELECT.
 *
 * No caching — keep the read fresh so a key add/delete on the same
 * request lifetime is reflected immediately.
 */

import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function userHasByokKey(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // V1.x-C.3 deprecation note: per-user BYOK is in the transition window.
  // Active rows still resolve as BYOK so the factory's Option A layer 2
  // can route them. Rows marked `deprecated_at` (by M-138's one-shot
  // migration to per-org) are excluded so the factory falls through to
  // the platform key for users whose org migrated.
  //
  // Final removal of the per-user path is a V2 cleanup once all V1
  // orgs are confirmed on the per-org model.
  const { count, error } = await supabase
    .from('user_anthropic_keys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('deprecated_at', null)
  if (error) {
    console.warn('[lib/llm/byok] userHasByokKey query failed:', error.message)
    return false
  }
  const hasKey = (count ?? 0) > 0
  if (hasKey) {
    console.warn(
      `[lib/llm/byok] V1.x-C.3 deprecation: per-user BYOK is in the transition window. ` +
        `User ${userId} has an active per-user key. Migrate to per-org BYOK by upgrading the ` +
        `user's organisation to plan byok_solo/byok_team and re-uploading the key via the ` +
        `org settings panel. V2 will remove this layer.`,
    )
  }
  return hasKey
}
