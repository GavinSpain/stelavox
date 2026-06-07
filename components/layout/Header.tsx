// Spec: stelavox_component_specification_v2_0.md §2.2 (Header)
//       stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-3 (Wordmark mount)
//
// Phase 8.01.A T-3: Wordmark placeholder text replaced by the real
// <Wordmark> component.
// Phase 8.01 wireframe-alignment round 2 (Brand Identity v2.4): Header
// rebuilt to match the wireframe header pattern. The mode-tab pill
// grouper sits immediately right of the wordmark (not pushed to the
// right next to user info). The right side carries the Search ⌘K chip
// and the UserMenu (avatar + name + dropdown), replacing the prior
// email text + Sign Out button.
//
// The component is presentational. The auth gate stays in (app)/layout.tsx;
// the user's email flows in as a prop so this file does not import any
// Supabase client. Inviolable #2 / Phase 2 verdigris audit: `--color-accent`
// MUST NOT appear in this file — the verdigris uses are inside <Wordmark>
// (uses #1 lozenge + #2 rule).

import Link from 'next/link'
import { ModeTabBar } from './ModeTabBar'
import { Wordmark } from '@/components/brand/Wordmark'
import { TreeSummonButton } from './TreeSummonButton'
import { SearchChip } from './SearchChip'
import { UserMenu } from './UserMenu'

interface HeaderProps {
  userEmail: string
}

export function Header({ userEmail }: HeaderProps) {
  return (
    <header
      data-testid="app-header"
      style={{
        height: '52px',
        flexShrink: 0,
        background: 'var(--color-bg-surface)',
        borderBottom: '1px solid var(--color-border-subtle)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        zIndex: 10,
      }}
    >
      {/* Phase 8.01.F T-3 — Tree summon button (☰), visible only at
         tablet-portrait. Self-hides at desktop / tablet-landscape. */}
      <TreeSummonButton />

      {/* Wordmark links to /dashboard — global home affordance.
         Phase 8.01.A T-3: real <Wordmark> component. */}
      <Link
        href="/dashboard"
        aria-label="Stelavox — home"
        style={{
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <Wordmark size="compact" />
      </Link>

      {/* Mode tabs sit immediately right of the wordmark per wireframe
         02_edit_mode_v2_iter3.html .mode-tabs (margin-left:32px from
         wordmark). ModeTabBar self-hides on non-document routes. */}
      <div style={{ marginLeft: 32 }}>
        <ModeTabBar />
      </div>

      {/* Flex spacer pushes the right cluster to the edge. */}
      <div style={{ flex: 1 }} aria-hidden="true" />

      {/* Right cluster — Search chip + UserMenu (avatar + name + dropdown). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <SearchChip />
        <UserMenu userEmail={userEmail} />
      </div>
    </header>
  )
}
