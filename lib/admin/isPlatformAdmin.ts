import 'server-only'

/**
 * V1.x-E.2 — platform admin auth check.
 *
 * Source: Component Spec §17.5 · wireframe_admin_dashboard_v1.html §05
 * decision 1 (locked: env-var allowlist).
 *
 * Reads PLATFORM_ADMIN_EMAILS from env (comma-separated) and checks
 * the authenticated user's email against the list. Suitable for V1
 * with 1–3 platform operators; V2 candidate to migrate to a
 * users.is_platform_admin column or app_metadata.role flag once a
 * real admin user base exists.
 *
 * Both the /admin page (server component) and /api/admin/* routes
 * call this. Belt-and-braces — page redirects + API returns 403 on
 * miss so a non-admin can't reach data via direct API call.
 *
 * The comparison is case-insensitive on email (auth.users emails are
 * stored lowercase by Supabase but env values are user-provided).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

function parseAllowlist(): Set<string> {
  const raw = process.env.PLATFORM_ADMIN_EMAILS ?? ''
  const items = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0)
  return new Set(items)
}

/**
 * Returns true iff the caller's authenticated user has an email in
 * PLATFORM_ADMIN_EMAILS. Returns false on missing user, missing email,
 * or empty allowlist.
 */
export async function isPlatformAdmin(
  supabase: SupabaseClient,
): Promise<boolean> {
  const allowlist = parseAllowlist()
  if (allowlist.size === 0) return false

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user || typeof user.email !== 'string' || user.email.length === 0) {
    return false
  }

  return allowlist.has(user.email.toLowerCase())
}
