import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

// Service-role client. Bypasses RLS. Use only in server-side code paths that
// genuinely need it: getConfig() (reading platform_config), template lookups
// (reading layer_stacks rows where organisation_id IS NULL), and migration
// tooling. Never instantiate this in an API route that handles a user session.
export function createServiceRoleClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}
