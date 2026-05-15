import { redirect } from 'next/navigation'

import { CostMeterFull } from '@/components/cost/CostMeterFull'
import { createClient } from '@/lib/supabase/server'

/**
 * V1.x-D — /settings/usage.
 *
 * Mounts the CostMeter full form for the user's primary organisation.
 * Primary org resolved server-side (owner > admin > member; oldest
 * joined_at tiebreak) so the client can request /api/usage/current-period
 * with a known orgId.
 */
export default async function UsageSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: memberships } = await supabase
    .from('organisation_members')
    .select('organisation_id, role, joined_at')
    .eq('user_id', user.id)

  const sorted = (memberships ?? []).slice().sort((a, b) => {
    const rolePriority = (r: string) => (r === 'owner' ? 0 : r === 'admin' ? 1 : r === 'member' ? 2 : 3)
    const ra = rolePriority(a.role)
    const rb = rolePriority(b.role)
    if (ra !== rb) return ra - rb
    return new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  })
  const orgId = sorted[0]?.organisation_id ?? null

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 32px' }}>
      <div style={{ marginBottom: 16 }}>
        <a
          href="/settings"
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          ← Settings
        </a>
      </div>
      <h1
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 22,
          fontWeight: 500,
          margin: '0 0 16px',
          color: 'var(--color-text-primary)',
        }}
      >
        Usage &amp; Billing
      </h1>
      {orgId ? (
        <CostMeterFull orgId={orgId} />
      ) : (
        <div
          style={{
            padding: 16,
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
          }}
        >
          You don&apos;t belong to any organisation yet.
        </div>
      )}
    </div>
  )
}
