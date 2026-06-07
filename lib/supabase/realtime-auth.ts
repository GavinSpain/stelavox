'use client'

/**
 * Realtime auth helper — call before opening any postgres_changes channel.
 *
 * Diagnosed 2026-06-07. The full background is in
 * `feedback_intermittent_problem_methodology.md`. Short version:
 *
 * `@supabase/ssr`'s browser client loads the auth JWT from cookies
 * asynchronously. If `.subscribe()` runs before that load completes,
 * Realtime registers the channel with `role='anon'` in
 * `realtime.subscription`. Any RLS policy that requires the
 * authenticated user (the common case) then silently drops every
 * event. The auth-state-change listener does NOT retroactively
 * re-authenticate existing channels — once anon, always anon, with no
 * recovery short of resubscribing.
 *
 * This helper awaits the session and pushes the access token into the
 * Realtime socket explicitly, so the subscribe handshake carries the
 * JWT and the registration lands as `role='authenticated'`.
 *
 * Usage shape across every `useEffect` that opens a postgres_changes
 * channel:
 *
 *   useEffect(() => {
 *     if (!someId) return
 *     const supabase = createClient()
 *     let channel: ReturnType<typeof supabase.channel> | null = null
 *     let mounted = true
 *
 *     void (async () => {
 *       await ensureRealtimeAuth(supabase)
 *       if (!mounted) return
 *       channel = supabase.channel('...').on(...).subscribe()
 *     })()
 *
 *     return () => {
 *       mounted = false
 *       if (channel) void supabase.removeChannel(channel)
 *     }
 *   }, [someId])
 *
 * The `mounted` guard matters — if the component unmounts before the
 * auth promise resolves, we'd otherwise open a leaked channel that
 * never gets cleaned up.
 *
 * If no session exists (signed-out viewer), the helper silently no-ops
 * and the channel subscribes as anon. That's the correct behaviour for
 * routes that legitimately expose data to anon — they wouldn't be
 * mounted to a signed-out user in this codebase, but the helper
 * tolerates the case rather than throwing.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export async function ensureRealtimeAuth(
  supabase: SupabaseClient,
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession()
  if (session?.access_token) {
    supabase.realtime.setAuth(session.access_token)
  }
}
