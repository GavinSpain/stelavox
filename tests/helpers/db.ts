import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../lib/types/database'

export function adminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export function anonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function tableCounts(tables: string[]): Promise<Record<string, number>> {
  const admin = adminClient()
  const out: Record<string, number> = {}
  for (const t of tables) {
    const { count } = await (admin.from(t as keyof Database['public']['Tables'] & string)
      .select('*', { count: 'exact', head: true }) as unknown as Promise<{ count: number | null }>)
    out[t] = count ?? 0
  }
  return out
}

// H-01 (round-3 audit F-258): .maybeSingle() — a user not yet in any
// organisation_members row is a valid result and should not surface as
// a PGRST116 error.
export async function getOrgId(userId: string): Promise<string | null> {
  const { data } = await adminClient()
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .maybeSingle()
  return data?.organisation_id ?? null
}
