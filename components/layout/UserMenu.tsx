'use client'

// Phase 8.01 wireframe-alignment round 2 — Header user identity.
//
// Replaces the live header's plain email + Sign Out button with the
// wireframe pattern: circular 28×28 avatar (initials) + display name +
// dropdown menu containing Account and Sign Out.
//
// Phase 8 nav cleanup follow-up (2026-06-09): the label was previously
// "Settings" — renamed to "Account" to disambiguate from the project
// page's Settings tab (different concept entirely). The /settings URL
// stays for backward compat; only the user-facing label changed. The
// page heading at /settings is also "Account" now. See CLAUDE.md
// changelog for the rationale.
//
// Spec: docs/wireframes/wireframe_phase8_01_ux_consistency/02_edit_mode_v2_iter3.html
//       .uav (user avatar) — 30×30 circle, --color-bg-surface bg,
//       --color-border-strong border, 11px/500 initials.
//       Wireframe shows initials "AS" — we derive from email local-part.
//
// Inviolable #2: zero verdigris in this file. Avatar bg is bg-surface,
// border is border-strong. Active states use neutral hover token.

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

interface UserMenuProps {
  userEmail: string
}

/** Pure helper — exported for unit tests. Derives display name and
 *  initials from the email local-part. `author@stelavox.local` →
 *  `Author` / `A`. `gavin.spain@example.com` → `Gavin Spain` / `GS`.
 *  `acme_admin@x.io` → `Acme Admin` / `AA`. */
export function deriveIdentity(email: string): { displayName: string; initials: string } {
  const local = (email.split('@')[0] ?? email).trim()
  if (!local) return { displayName: '?', initials: '?' }
  // Split on common separators in local-parts.
  const parts = local
    .split(/[._-]+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return { displayName: '?', initials: '?' }
  const displayName = parts
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(' ')
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')
  return { displayName, initials }
}

export function UserMenu({ userEmail }: UserMenuProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current) return
      if (rootRef.current.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', handlePointerDown, true)
    return () => window.removeEventListener('pointerdown', handlePointerDown, true)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open])

  const { displayName, initials } = deriveIdentity(userEmail)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <div
      ref={rootRef}
      data-testid="user-menu"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 10 }}
    >
      <span
        data-testid="user-menu-name"
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12,
          color: 'var(--color-text-primary)',
        }}
      >
        {displayName}
      </span>
      <button
        type="button"
        data-testid="user-menu-avatar"
        data-initials={initials}
        aria-label={`${displayName} — open user menu`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-strong)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {initials}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="user-menu-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 180,
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 6,
            padding: 4,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <div
            style={{
              padding: '8px 10px 6px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 11,
              color: 'var(--color-text-muted)',
              borderBottom: '1px solid var(--color-border-subtle)',
              marginBottom: 4,
              wordBreak: 'break-all',
            }}
          >
            {userEmail}
          </div>
          <Link
            href="/settings"
            role="menuitem"
            data-testid="user-menu-settings"
            onClick={() => setOpen(false)}
            style={{
              display: 'block',
              padding: '6px 10px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              color: 'var(--color-text-primary)',
              textDecoration: 'none',
              borderRadius: 3,
            }}
          >
            Account
          </Link>
          <button
            type="button"
            role="menuitem"
            data-testid="user-menu-signout"
            onClick={() => {
              setOpen(false)
              void handleSignOut()
            }}
            style={{
              display: 'block',
              padding: '6px 10px',
              background: 'transparent',
              border: 0,
              textAlign: 'left',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              color: 'var(--color-text-primary)',
              cursor: 'pointer',
              borderRadius: 3,
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
