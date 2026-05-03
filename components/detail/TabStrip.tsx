'use client'

// Spec: stelavox_component_specification_v2_0.md §5.2 (TabStrip)
//       stelavox_brand_identity_v2_0.md §12 Inviolable #2
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.6 T-6.1
//
// Inviolable #2 trap: the active indicator is `--color-text-primary`
// at 0.6 opacity — NOT `--color-accent`. Verified via the Build
// Checklist's §2 Phase Checkpoint criterion 13 (verdigris audit).
// `--color-accent` MUST NOT appear in this file.

interface Tab {
  id: string
  label: string
}

interface TabStripProps {
  tabs: readonly Tab[]
  activeId: string
  onChange: (id: string) => void
}

export function TabStrip({ tabs, activeId, onChange }: TabStripProps) {
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        borderBottom: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeId
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            style={{
              height: '32px',
              padding: '0 12px',
              background: 'transparent',
              border: 'none',
              borderBottom: '2px solid transparent',
              fontSize: 'var(--text-sm)',
              fontWeight: isActive ? 500 : 400,
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              cursor: 'pointer',
              // Active indicator: --color-text-primary at 0.6 opacity
              // (Component Spec §5.2 / Inviolable #2 — NOT --color-accent).
              // color-mix gives us the opacity-60% form of the token
              // without hardcoding the hex behind the token.
              boxShadow: isActive
                ? 'inset 0 -2px 0 color-mix(in srgb, var(--color-text-primary) 60%, transparent)'
                : 'none',
              transition: 'color var(--duration-fast), box-shadow var(--duration-fast)',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
