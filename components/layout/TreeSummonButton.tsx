'use client'

// Phase 8.01.F T-3 — Tree summon button in Header.
//
// Visible only at the tablet-portrait breakpoint — the only viewport
// where the tree slides over by default. Toggles the tree slide-over.
//
// Touch target: 44×44 minimum per spec.

import { useViewportBreakpoint } from '@/lib/hooks/useViewportBreakpoint'
import { toggleTreeSlideOver, useTreeSlideOverOpen } from '@/lib/stores/slide-over-state'

export function TreeSummonButton() {
  const bp = useViewportBreakpoint()
  const open = useTreeSlideOverOpen()
  // Only render on tablet-portrait. Desktop + tablet-landscape have the
  // tree pinned in AppShell. Phone is out of V1 scope.
  if (bp !== 'tablet-portrait') return null

  return (
    <button
      type="button"
      data-testid="tree-summon-button"
      data-active={open ? 'true' : 'false'}
      aria-label="Open tree"
      aria-expanded={open}
      onClick={toggleTreeSlideOver}
      style={{
        width: 44,
        height: 44,
        border: open ? '1px solid var(--color-border-strong)' : '1px solid var(--color-border-default)',
        borderRadius: 6,
        background: open ? 'var(--color-bg-elevated)' : 'transparent',
        color: open ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
        cursor: 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 18,
        flexShrink: 0,
        marginRight: 12,
      }}
    >
      ☰
    </button>
  )
}
