// Spec: stelavox_component_specification_v2_0.md §2.2 (Header)
//       stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.2
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-3 (Wordmark mount)
//
// Phase 8.01.A T-3: Wordmark placeholder text replaced by the real
// <Wordmark> component (Brand Identity v2.2 §3.2). The Phase 2 placeholder
// note in the original header — "the brand <Wordmark> component arrives in
// a later phase" — is closed by this change.
//
// The component is presentational. The auth gate stays in (app)/layout.tsx;
// the user's email flows in as a prop so this file does not import any
// Supabase client. Inviolable #2 / Phase 2 verdigris audit: `--color-accent`
// MUST NOT appear in this file — the verdigris uses are inside <Wordmark>
// (uses #1 lozenge + #2 rule).

import Link from 'next/link'
import SignOutButton from '@/components/auth/SignOutButton'
import { ModeTabBar } from './ModeTabBar'
import { Wordmark } from '@/components/brand/Wordmark'

interface HeaderProps {
  userEmail: string
}

export function Header({ userEmail }: HeaderProps) {
  return (
    <header
      style={{
        height: '48px',
        flexShrink: 0,
        background: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '0 var(--space-5)',
        display: 'flex',
        alignItems: 'center',
        zIndex: 10,
      }}
    >
      {/* Wordmark links to /dashboard — global home affordance. Fixes
         the dead-end on /settings/* (no other way back to the project
         list without the browser back button). Phase 8.01.A T-3:
         placeholder text replaced by the real <Wordmark> component. */}
      <Link
        href="/dashboard"
        aria-label="Stelavox — home"
        style={{
          marginRight: '28px',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Wordmark size="compact" />
      </Link>

      <div style={{ flex: 1 }} aria-hidden="true" />

      <div style={{ margin: '0 var(--space-5)' }}>
        <ModeTabBar />
      </div>

      <div
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
        }}
      >
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          {userEmail}
        </span>
        <Link
          href="/settings"
          data-testid="header-settings-link"
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
            padding: '4px 8px',
            borderRadius: 4,
          }}
        >
          Settings
        </Link>
        <SignOutButton />
      </div>
    </header>
  )
}
