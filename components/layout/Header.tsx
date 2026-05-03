// Spec: stelavox_component_specification_v2_0.md §2.2 (Header)
//       stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.2
//
// Phase 2 Header — 48px fixed, four child zones per Component Spec §2.2:
//   1. Wordmark            — Phase 2 placeholder text "Stelavox" (the brand
//                            <Wordmark> component arrives in a later phase)
//   2. HeaderBreadcrumb    — empty placeholder (flex:1 spacer)
//   3. ModeTabBar          — Edit active; Director/Focus disabled stubs
//   4. HeaderActions       — user email + SignOutButton (carried from Phase 1)
//
// The component is presentational. The auth gate stays in (app)/layout.tsx;
// the user's email flows in as a prop so this file does not import any
// Supabase client. Inviolable #2 / Phase 2 verdigris audit: `--color-accent`
// MUST NOT appear in this file.

import SignOutButton from '@/components/auth/SignOutButton'
import { ModeTabBar } from './ModeTabBar'

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
      <span
        style={{
          marginRight: '28px',
          fontWeight: 500,
          fontSize: '16px',
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.01em',
        }}
      >
        Stelavox
      </span>

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
        <SignOutButton />
      </div>
    </header>
  )
}
