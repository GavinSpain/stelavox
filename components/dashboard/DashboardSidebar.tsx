'use client'

// Phase 8.01.D T-5 — DashboardSidebar.
//
// Single component with `shape: 'populated' | 'first-time'` per locks
// from the build checklist:
//   - Populated: LIBRARY (All / Recent) — NO Archived row per OQ-4 lock;
//                CONTEXT (Characters / Locations / Themes); SYSTEM links;
//                permanent "Try a sample" link in LEARN section (OQ-3 3a).
//   - First-time: QUICK START checklist; LEARN section with Walkthrough + Sample.
//
// Inviolable #2: no verdigris. Counts in monospace, neutral palette.

import Link from 'next/link'
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

function CountRow({ label, count, href }: { label: string; count: number; href?: string }) {
  const inner = (
    <>
      <span>{label}</span>
      <span
        style={{
          marginLeft: 'auto',
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          color: 'var(--color-text-muted)',
        }}
      >
        {count}
      </span>
    </>
  )
  if (href) return <Link href={href} style={ROW_STYLE}>{inner}</Link>
  return <div style={ROW_STYLE}>{inner}</div>
}

function ActionRow({ href, label, onClick, testid }: { href?: string; label: string; onClick?: () => void; testid?: string }) {
  if (href) {
    return (
      <Link href={href} style={ROW_STYLE} data-testid={testid}>
        {label}
      </Link>
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
            <div style={LABEL_STYLE}>LIBRARY</div>
            <CountRow label="All projects" count={counts?.allProjects ?? 0} href="/dashboard" />
            <CountRow label="Recent" count={counts?.recent ?? 0} />
            {/* OQ-4 lock: Archived row OMITTED — archive feature doesn't exist yet. */}
          </section>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>CONTEXT</div>
            <CountRow label="Characters" count={counts?.characters ?? 0} />
            <CountRow label="Locations" count={counts?.locations ?? 0} />
            <CountRow label="Themes" count={counts?.themes ?? 0} />
          </section>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>LEARN</div>
            <ActionRow label="Walkthrough" href="#" />
            {/* OQ-3 (3a) lock: permanent "Try a sample" link in the populated sidebar. */}
            <ActionRow label="Try a sample" onClick={onTrySample} testid="sidebar-try-sample" />
          </section>
          <section style={{ padding: '0 16px 16px' }}>
            <div style={LABEL_STYLE}>SYSTEM</div>
            <ActionRow label="Settings" href="/settings" />
            <ActionRow label="Exports" href="/settings" />
            <ActionRow label="Usage" href="/settings/usage" />
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
            <ActionRow label="Walkthrough" href="#" />
            <ActionRow label="Sample novel tour" onClick={onTrySample} testid="sidebar-try-sample" />
          </section>
        </>
      )}
    </aside>
  )
}
