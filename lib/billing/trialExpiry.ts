/**
 * Phase 9.B work package B — trial-expiry helpers.
 *
 * The product lock for trial expiry (locked 2026-06-11):
 *   "When the 30-day trial is up, the user gets redirected to the
 *    plan-buy page when logging in. We don't delete the account or
 *    data — just let them know it's time to sign up for a paid account."
 *
 * "Credit exhaustion never blocks writing" applies to PAID plans only —
 * a paid author who runs out of credits keeps writing manually and the
 * Director just refuses dispatch until the next period. A trial author
 * who runs out of TIME (the 30 days elapsed) is fully redirected.
 *
 * The (app)/layout.tsx calls isTrialExpired() with the org's
 * { plan, trial_expires_at } and the layout's `x-pathname` header.
 * When true, the layout calls redirect('/settings/plan?reason=trial_expired').
 */

export interface TrialOrgState {
  plan: string | null
  trial_expires_at: string | null // ISO timestamp from DB
}

/**
 * Returns true when the org is on the trial plan AND the trial has
 * expired (current time >= trial_expires_at). Paid plans + BYOK plans
 * always return false (those gates run elsewhere). NULL plan defaults
 * to "not trial" — defensive, since the schema default is 'trial'.
 */
export function isTrialExpired(org: TrialOrgState, now: Date = new Date()): boolean {
  if (org.plan !== 'trial') return false
  if (!org.trial_expires_at) return false
  const expiresAt = new Date(org.trial_expires_at)
  if (Number.isNaN(expiresAt.getTime())) return false
  return now >= expiresAt
}

/**
 * Returns true when the request path is one the trial-expiry redirect
 * should NOT touch — these are the pages the user lands on to actually
 * subscribe (preventing a redirect loop) plus auth-flow pages.
 */
export function isPathTrialExempt(pathname: string | null): boolean {
  if (!pathname) return true // fail open — better than a loop
  if (pathname.startsWith('/settings/plan')) return true
  if (pathname.startsWith('/api/billing')) return true
  if (pathname.startsWith('/api/stripe')) return true
  return false
}
