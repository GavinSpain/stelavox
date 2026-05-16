/**
 * V1.x-F.2 — client-safe `interpolate` for failure-message templates.
 *
 * Server-side template fetching lives in lib/ui/failureMessages.ts
 * (server-only per H-12 — platform_config reads stay on the server).
 * The client receives pre-fetched templates as props and substitutes
 * per-event `{token}` values at render time via this helper.
 *
 * Token semantics match the templates in M-147:
 *   - Class A: {attempt}, {max_attempts}
 *   - Class C: {pause_seconds}
 *   - Class D: {failure_class}, {node_name}, {reason}
 *   - Class E: {job_id}
 */

export function interpolateFailureMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  let out = template
  for (const [key, val] of Object.entries(vars)) {
    out = out.replaceAll(`{${key}}`, String(val))
  }
  return out
}
