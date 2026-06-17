'use client'

/**
 * AdminShell — the self-contained chrome for the admin operational
 * interface (wireframe_admin_shell_v1.html). Left-rail nav across the
 * three sections + content area. No AppShell, no app navigation, no
 * Dashboard back-link. Inter only; no verdigris (active nav uses
 * --color-bg-selected + a neutral left border).
 *
 * Rendered by app/(admin)/layout.tsx, which gates on isPlatformAdmin.
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import SignOutButton from '@/components/auth/SignOutButton'

const NAV: { href: string; label: string; icon: string; exact?: boolean }[] = [
  { href: '/admin', label: 'Operations', icon: '◷', exact: true },
  { href: '/admin/models', label: 'Models', icon: '◇' },
  { href: '/admin/payments', label: 'Payments', icon: '$' },
  { href: '/admin/orchestration', label: 'Orchestration', icon: '⛓' },
]

export function AdminShell({
  userEmail,
  children,
}: {
  userEmail: string
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + '/')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '210px 1fr',
        minHeight: '100vh',
        background: 'var(--color-bg-base)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      {/* Left rail */}
      <nav
        style={{
          background: 'var(--color-bg-surface)',
          borderRight: '1px solid var(--color-border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '18px 16px 16px', borderBottom: '1px solid var(--color-border-subtle)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            Stelavox Admin
          </div>
          <div style={{
            fontSize: 9, fontWeight: 500, letterSpacing: '.22em', textTransform: 'uppercase',
            color: 'var(--color-text-muted)', marginTop: 4,
          }}>
            Operations console
          </div>
        </div>

        <div style={{ padding: '10px 8px', flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {NAV.map((item) => {
            const active = isActive(item.href, item.exact)
            return (
              <Link
                key={item.href}
                href={item.href}
                data-testid={`admin-nav-${item.label.toLowerCase()}`}
                data-active={active}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 6, fontSize: 13,
                  textDecoration: 'none',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                  background: active ? 'var(--color-bg-selected)' : 'transparent',
                  borderLeft: `2px solid ${active ? 'var(--color-text-secondary)' : 'transparent'}`,
                  fontWeight: active ? 500 : 400,
                }}
              >
                <span aria-hidden style={{ width: 16, textAlign: 'center', opacity: 0.8 }}>{item.icon}</span>
                {item.label}
              </Link>
            )
          })}
        </div>

        <div style={{ padding: '12px 14px', borderTop: '1px solid var(--color-border-subtle)' }}>
          <div
            title={userEmail}
            style={{
              fontSize: 11, color: 'var(--color-text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8,
            }}
          >
            {userEmail}
          </div>
          <SignOutButton />
        </div>
      </nav>

      {/* Content */}
      <main style={{ minWidth: 0, padding: 'var(--space-4)' }}>
        {children}
      </main>
    </div>
  )
}
