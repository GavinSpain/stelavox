import { createBrowserClient } from '@supabase/ssr'

import { requireEnv } from '@/lib/env'

export function createClient() {
  return createBrowserClient(
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_URL, 'NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { flowType: 'pkce' } },
  )
}
