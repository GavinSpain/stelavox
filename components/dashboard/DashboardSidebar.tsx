'use client'

// Phase 8.01.D T-5 — DashboardSidebar.
//
// Single component with `shape: 'populated' | 'first-time'`:
//   - Populated: LEARN section (Try a sample).
//   - First-time: QUICK START checklist; LEARN (Sample novel tour).
//
// Phase 8 nav cleanup (2026-06-08):
//   - LIBRARY section deleted. The "All projects" row was a circular
//     <Link> back to /dashboard with a count; "Recent" was a count
//     with no link. Both duplicated the centre-panel ProjectGrid
//     without adding navigation power. If we want a real "Recent"
//     filter, build it as a chip above the grid where it can actually
//     filter — not as an inert count in the sidebar.
//   - CONTEXT section deleted. Aggregated counts of context nodes
//     across all projects in the org had no scope — context is
//     project-scoped (a character belongs to a novel). The document
//     page's Sidebar already shows the 6 context types properly
//     scoped with inline create-and-link UX.
//   - SYSTEM > Exports row deleted. Linked to /settings which has no
//     Exports page. Exports are document-scoped in the implementation
//     (the Export button lives on the Project page Export tab).
//   - LEARN > Walkthrough row deleted. href="#" placeholder; Phase 12
//     user-docs work will resurrect it with a real destination.
//
// Phase 8 nav cleanup follow-up (2026-06-09):
//   - SYSTEM section deleted in its entirety. Settings + Usage were
//     duplicates of the Header UserMenu (avatar dropdown) which is
//     available from every page. Settings is global chrome; it now
//     lives in exactly one canonical place. Usage is reachable via
//     Settings → Usage. Project Sidebar's footer Settings link
//     deleted in the same pass.
//
// Inviolable #2: no verdigris.

import { QuickStartChecklist, type QuickStartCompletion } from './QuickStartChecklist'

export interface SidebarCounts {
  allProjects: number
  recent: number  // updated in last 7d
  characters: number
  locations: number
  themes: number
}

interface DashboardSidebarProps {
  shape: 'populated' | 'first-time'
  counts?: SidebarCounts
  quickStart?: QuickStartCompletion
  onTrySample?: () => void
}

const LABEL_STYLE = {
  fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace' as const,
  fontSize: 10.5,
  letterSpacing: '0.06em',
  color: 'var(--color-text-muted)',
  padding: '0 0 8px',
}

const ROW_STYLE = {
  display: 'flex' as const,
  alignItems: 'center' as const,
  gap: 10,
  padding: '7px 10px',
  borderRadius: 4,
  fontFamily: 'var(--font-inter), Inter, sans-serif' as const,
  fontSize: 12.5,
  color: 'var(--color-text-primary)',
  textDecoration: 'none' as const,
  minHeight: 44,
}

// Phase 8 nav cleanup: CountRow deleted alongside the LIBRARY +
// CONTEXT sections that consumed it. Re-add if a future section
// genuinely benefits from the count-row shape.

function ActionRow({ href, label, onClick, testid }: { href?: string; label: string; onClick?: () => void; testid?: string }) {
  if (href) {
    return (
      <a href={href} style={ROW_STYLE} data-testid={testid}>
        {label}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      style={{
        ...ROW_STYLE,
        background: 'transparent',
        border: 0,
        cursor: 'pointer',
        textAlign: 'left',
        width: '100%',
      }}
    >
      {label}
    </button>
  )
}

export function DashboardSidebar({ shape, counts, quickStart, onTrySample }: DashboardSidebarProps) {
  return (
    <aside
      data-testid="dashboard-sidebar"
      data-shape={shape}
      style={{
        width: 240,
        borderRight: '1px solid var(--color-border-subtle)',
        padding: '16px 0',
        flexShrink: 0,
        overflowY: 'auto',
      }}
    >
      {shape === 'populated' ? (
        <>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>LEARN</div>
            {/* OQ-3 (3a) lock: permanent "Try a sample" link in the populated sidebar. */}
            <ActionRow label="Try a sample" onClick={onTrySample} testid="sidebar-try-sample" />
          </section>
        </>
      ) : (
        <>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>QUICK START</div>
            {quickStart && <QuickStartChecklist completion={quickStart} />}
          </section>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>LEARN</div>
            <ActionRow label="Sample novel tour" onClick={onTrySample} testid="sidebar-try-sample" />
          </section>
        </>
      )}
    </aside>
  )
}
