import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient as createSSRServerClient } from '@supabase/ssr'

import { requireEnv } from '@/lib/env'

export async function createClient() {
  const cookieStore = await cookies()

  return createSSRServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // setAll called from a Server Component — Next.js disallows cookie writes there.
            // Middleware refreshes the session on every request, so this is safe to swallow.
          }
        },
      },
    },
  )
}
