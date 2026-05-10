/**
 * Required-env-var helper (round-3 audit B7.3 / F-167).
 *
 * Pre-fix every Supabase factory used `process.env.X!` non-null
 * assertions. If env vars were unset (deploy misconfiguration, missing
 * `.env.local`), the `!` produced `undefined`, Supabase init threw with
 * an opaque `TypeError: Cannot read properties of undefined`. No
 * early-throw path with a clear "missing env var" message.
 *
 * IMPORTANT — Next.js client bundle compatibility:
 *
 * Next.js performs build-time string substitution for
 * `process.env.NEXT_PUBLIC_*` references it can statically see in
 * client code. A dynamic lookup like `process.env[name]` where `name`
 * is a variable cannot be substituted — at runtime in the browser
 * `process.env` is `{}` (or undefined), so the dynamic read returns
 * undefined and the helper throws even when the var IS set.
 *
 * To stay compatible with Next.js's static analysis, callers MUST pass
 * the env-var reference as the first argument (statically resolvable
 * at build time) AND the var name as the second argument (for the
 * error message). The helper validates whatever the caller passes.
 *
 *   const url = requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL')
 *   const key = requireEnv(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
 *
 * This is slightly verbose but it's the only shape that works in both
 * server-side and Next.js-client-bundled contexts.
 */

export function requireEnv(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(
      `Required environment variable ${name} is not set. ` +
      `Check .env.local (local dev) or your deployment env (Vercel / cloud). ` +
      `See docs/stelavox_deployment_setup_v1_0.md §6 for the full var list.`,
    )
  }
  return value
}
