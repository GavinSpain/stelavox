import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Refresh the user's Supabase session cookie on every request that passes
// through Next.js middleware. This keeps the session alive across navigations
// and ensures Server Components see a fresh session on first paint.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  return response
}
