/**
 * Phase 9.E (DR-020) — map an HTTP failure to a V1.x-F failure class.
 *
 * Client-safe (no platform_config reads). Deterministic status → class
 * mapping so the FailureToast / FailureBanner surfaces render the right
 * tone for each failure mode.
 *
 * Two statuses are deliberately EXCLUDED (returns null → caller renders
 * its dedicated surface instead, no double-render):
 *   - 423 locked → DR-046 editor lock-paused banner
 *   - 422 injection_blocked → DR-050 SecurityWarningBanner
 *
 * Failure-class taxonomy (V1.x-F):
 *   A — transient (retry) · toast · --color-info
 *   C — capacity / back-off · toast · --color-status-review
 *   D — validation / rejected · banner · --color-error left border
 *   E — hard system error · banner · full --color-error
 */

export type FailureClassKind = 'A' | 'C' | 'D' | 'E'

export interface FailureClassification {
  classKind: FailureClassKind
  surface: 'toast' | 'banner'
}

/**
 * Classify a failed response. `errorCode` is the server's `error` field
 * (e.g. 'token_budget_exceeded', 'rate_limit_check_unavailable').
 *
 * Returns null when the caller should render a dedicated surface
 * instead (423 lock, 422 injection) or when the status doesn't map to a
 * failure-class surface.
 */
export function classifyFailure(
  status: number | null,
  errorCode?: string | null,
): FailureClassification | null {
  // Network error (fetch threw — no status) → hard system.
  if (status === null) {
    return { classKind: 'E', surface: 'banner' }
  }

  // Dedicated surfaces own these — don't double-render.
  if (status === 423) return null
  if (status === 422 && errorCode === 'injection_blocked') return null

  // Transient — retry will likely self-heal.
  if (status === 429) return { classKind: 'A', surface: 'toast' }
  if (status === 503) return { classKind: 'A', surface: 'toast' }

  // Capacity / budget — the request was refused because the org is out
  // of headroom. Banner with remediation (upgrade / manage plan).
  if (status === 402) return { classKind: 'D', surface: 'banner' }

  // Validation / rejected (other 4xx).
  if (status >= 400 && status < 500) {
    return { classKind: 'D', surface: 'banner' }
  }

  // Hard system error.
  if (status >= 500) {
    return { classKind: 'E', surface: 'banner' }
  }

  return null
}
