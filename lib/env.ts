/**
 * Required-env-var helper (round-3 audit B7.3 / F-167).
 *
 * Pre-fix every Supabase factory used `process.env.X!` non-null
 * assertions. If env vars were unset (deploy misconfiguration, missing
 * `.env.local`), the `!` produced `undefined`, Supabase init threw with
 * an opaque `TypeError: Cannot read properties of undefined`. No
 * early-throw path with a clear "missing env var" message.
 *
 * `requireEnv(name)` checks for non-empty (whitespace-only counts as
 * empty) and throws an informative error otherwise. Intended for top-of-
 * factory use:
 *
 *   const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
 *   const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
 */

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
      `Check .env.local (local dev) or your deployment env (Vercel / cloud). ` +
      `See docs/stelavox_deployment_setup_v1_0.md §6 for the full var list.`,
    )
  }
  return value
}
