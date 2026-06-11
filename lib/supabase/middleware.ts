import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { requireEnv } from '@/lib/env'

// Refresh the user's Supabase session cookie on every request that passes
// through Next.js middleware. This keeps the session alive across navigations
// and ensures Server Components see a fresh session on first paint.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Touch auth.getUser so the SSR client refreshes the access-token cookie if
  // it is close to expiry. Do not log out the user here — middleware runs on
  // every request, including public pages.
  await supabase.auth.getUser()

  // Phase 9.B — expose the current pathname to server components so the
  // (app)/layout.tsx can detect /settings/plan* and skip its
  // trial-expiry redirect (preventing a redirect loop).
  response.headers.set('x-pathname', request.nextUrl.pathname)

  return response
}
