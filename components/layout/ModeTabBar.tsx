// Spec: stelavox_component_specification_v2_0.md §2.5 (ModeTabBar)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.2
//
// Phase 2 stub: three tabs visible (Edit / Director / Focus). Edit is
// styled active; Director and Focus are disabled placeholders. No
// interactivity — mode switching arrives in Phase 5 along with the
// `⌘.` keybinding and URL state. Inviolable #2 / Phase 2 verdigris
// audit: `--color-accent` MUST NOT appear in this file.

const tabs = [
  { id: 'edit',     label: 'Edit',     active: true,  disabled: false },
  { id: 'director', label: 'Director', active: false, disabled: true  },
  { id: 'focus',    label: 'Focus',    active: false, disabled: true  },
] as const

export function ModeTabBar() {
  return (
    <div
      role="tablist"
      style={{
        display: 'inline-flex',
        background: 'var(--color-bg-base)',
        padding: 'var(--space-1)',
        borderRadius: '6px',
      }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          type="button"
          aria-selected={tab.active}
          aria-disabled={tab.disabled || undefined}
          disabled={tab.disabled}
          tabIndex={tab.active ? 0 : -1}
          style={{
            border: 'none',
            background: tab.active ? 'var(--color-bg-surface)' : 'transparent',
            color: tab.active
              ? 'var(--color-text-primary)'
              : 'var(--color-text-muted)',
            fontWeight: tab.active ? 500 : 400,
            fontSize: 'var(--text-sm)',
            padding: '4px 14px',
            borderRadius: 'var(--radius-sm)',
            cursor: tab.disabled ? 'not-allowed' : 'pointer',
            opacity: tab.disabled ? 0.5 : 1,
            transition:
              'background var(--duration-fast) var(--easing-smooth), ' +
              'color var(--duration-fast) var(--easing-smooth)',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
