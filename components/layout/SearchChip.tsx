'use client'

// Phase 8.01 wireframe-alignment round 2 — Header search chip.
// Phase 8.4 — click now dispatches the same window event ⌘K does.
//
// Spec: docs/wireframes/wireframe_phase8_01_ux_consistency/02_edit_mode_v2_iter3.html
//       .cmd-chip — --color-bg-surface background, --color-border-strong
//       border, monospace kbd hint.

import { COMMAND_PALETTE_OPEN_EVENT } from '@/components/help/KeyboardShortcutsProvider'

interface SearchChipProps {
  /** Optional label override; defaults to "Search". */
  label?: string
}

export function SearchChip({ label = 'Search' }: SearchChipProps) {
  return (
    <button
      type="button"
      data-testid="header-search-chip"
      onClick={() => {
        // Phase 8.4 — click and ⌘K go through the same window event;
        // Phase 8.1's command palette listens for it.
        window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT))
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 7,
        height: 26,
        padding: '0 10px 0 9px',
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-strong)',
        borderRadius: 4,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        fontWeight: 400,
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
        transition: 'border-color 120ms ease, color 120ms ease',
      }}
      onPointerEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent-hover)'
        e.currentTarget.style.color = 'var(--color-text-primary)'
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border-strong)'
        e.currentTarget.style.color = 'var(--color-text-secondary)'
      }}
    >
      <span aria-hidden style={{ fontSize: 12, opacity: 0.7 }}>⌕</span>
      <span>{label}</span>
      <kbd
        data-testid="header-search-kbd"
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10,
          color: 'var(--color-text-muted)',
          marginLeft: 6,
        }}
      >
        ⌘K
      </kbd>
    </button>
  )
}
