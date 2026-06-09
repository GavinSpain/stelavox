import Link from 'next/link'
import { redirect } from 'next/navigation'

import { OrgAnthropicKeyPanel } from '@/components/settings/OrgAnthropicKeyPanel'
import { createClient } from '@/lib/supabase/server'

/**
 * V1.x-C.4 — /settings/org-api-keys.
 *
 * Per-org BYOK key management. The page resolves the user's primary
 * org server-side (owner > admin > member; oldest joined_at as tiebreak,
 * matching the M-138 migration's resolution rule) and passes it to the
 * client panel. Multi-org users see the panel for whichever org appears
 * first in the resolution; explicit org selection is a V2 feature.
 *
 * Visible to all authenticated users — the panel itself surfaces a
 * "not admin" notice for non-admin members rather than gating the page.
 */
export default async function OrgApiKeysSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve primary org. Same precedence as M-138.
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
        {/* `replace` prevents history growth inside the Account hub. */}
        <Link
          href="/settings"
          replace
          style={{
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          ← Account
        </Link>
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
        Organisation API keys
      </h1>
      {orgId ? (
        <OrgAnthropicKeyPanel orgId={orgId} />
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
