'use client'

// Spec: stelavox_component_specification_v2_7.md §2.5 (ModeTabBar)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1
//
// Edit / Director / Focus tabs in the Header. Reads the active mode
// from ModeContext (lifted to AppShell). Focus is a transient overlay
// (not a stored mode), so its tab remains disabled here — entering
// Focus is a separate gesture handled in components/focus/.
//
// Per Component Spec §2.5: Inviolable #2 — `--color-accent` MUST NOT
// appear in this file. Active tab uses --color-text-primary +
// --color-bg-surface; the Director-running pulse dot uses
// --color-agent-running, NOT --color-accent.

import { useMode, type AppMode } from './ModeContext'

const TABS: ReadonlyArray<{ id: AppMode | 'focus'; label: string; selectable: boolean }> = [
  { id: 'edit',     label: 'Edit',     selectable: true  },
  { id: 'director', label: 'Director', selectable: true  },
  { id: 'focus',    label: 'Focus',    selectable: false },
]

export function ModeTabBar() {
  const { mode, setMode, enabled } = useMode()

  // SU-J12-6 (Mars-drive 2026-05-09): on non-document routes
  // (dashboard, project list, settings) the tab bar previously
  // rendered as disabled-grey but still visible, presenting a dead
  // affordance. Hide entirely when no document client is mounted.
  if (!enabled) return null

  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        background: 'var(--color-bg-base)',
        padding: 4,
        borderRadius: 6,
      }}
    >
      {TABS.map((tab) => {
        const active = enabled && tab.selectable && tab.id === mode
        const disabled = !enabled || !tab.selectable
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (disabled) return
              if (tab.id === 'focus') return
              setMode(tab.id)
            }}
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              border: 'none',
              background: active ? 'var(--color-bg-surface)' : 'transparent',
              color: active
                ? 'var(--color-text-primary)'
                : 'var(--color-text-muted)',
              fontWeight: active ? 500 : 400,
              fontSize: 12,
              padding: '4px 14px',
              borderRadius: 4,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled && !tab.selectable ? 0.5 : 1,
              transition:
                'background var(--duration-fast) var(--easing-smooth), ' +
                'color var(--duration-fast) var(--easing-smooth)',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
