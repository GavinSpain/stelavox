'use client'

// Spec: stelavox_component_specification_v2_0.md §2.3 (Sidebar)
//       stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.3
//
// Phase 2 Sidebar — left panel of AppShell. 220px expanded, 48px collapsed.
// Three vertical sections per Component Spec §2.3:
//   1. Project navigation (top, auto-height)
//   2. Context library    (middle, flex:1, scrollable; Phase 4 populates)
//   3. Settings footer    (bottom; collapse chevron lives here too)
//
// IMPORTANT — separation of concerns: the Sidebar does NOT contain the
// node tree. The node tree is the centre panel of AppShell, built in §3.4.
// Conflating them breaks Brand §8.3 (Director Mode: sidebar collapses to
// icon rail while tree remains visible) and §7.9 (Focus Mode: tree and
// sidebar retract independently).
//
// Inviolable #2: `--color-accent` MUST NOT appear in this file.
//
// Collapse state:
//   - Persisted in localStorage key `stelavox_sidebar_state` (the user's
//     manual preference).
//   - On hydration, server renders expanded; useEffect on mount reads
//     localStorage and updates if the user previously collapsed. There is
//     a brief one-frame flicker for users with stored 'collapsed' — fine
//     for a Phase 2 stub. Eliminate later with a cookie + pre-paint script
//     if it becomes noticeable.
//   - Future Phase 5 work: Director Mode auto-collapses the sidebar and
//     restores on exit. That auto-collapse must NOT write to localStorage
//     — it is transient state, distinct from the user's manual preference.

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'stelavox_sidebar_state'

interface SidebarProps {
  projectName?: string
  documentName?: string
}

export function Sidebar({ projectName, documentName }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    // Hydrate from localStorage. setState inside useEffect is the standard
    // SSR-safe pattern for client-only storage; refactoring to
    // useSyncExternalStore is overkill for a single boolean preference.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localStorage.getItem(STORAGE_KEY) === 'collapsed') setCollapsed(true)
  }, [])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
  }

  return (
    <aside
      style={{
        width: collapsed ? '48px' : '220px',
        flexShrink: 0,
        background: 'var(--color-bg-surface)',
        borderRight: '1px solid var(--color-border-subtle)',
        transition: 'width var(--duration-normal) var(--easing-smooth)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Project navigation — top, auto-height */}
      <div
        style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          minHeight: '60px',
        }}
      >
        {!collapsed && (
          <>
            <div
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 'var(--space-2)',
              }}
            >
              Project
            </div>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              {projectName ?? '—'}
            </div>
            {documentName && (
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-secondary)',
                  marginTop: 'var(--space-1)',
                }}
              >
                {documentName}
              </div>
            )}
          </>
        )}
      </div>

      {/* Context library — middle, flex:1, scrollable. Phase 4 populates. */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {!collapsed && (
          <div
            style={{
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Context library
          </div>
        )}
      </div>

      {/* Footer — settings link + collapse chevron */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {!collapsed && (
          <a
            href="/settings"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
            }}
          >
            Settings
          </a>
        )}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: 'var(--space-1)',
            fontSize: 'var(--text-base)',
            lineHeight: 1,
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
    </aside>
  )
}
