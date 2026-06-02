// Phase 8.01.E T-8 — StructureOverview render pinning.
//
// useEffect doesn't run under renderToString so the component renders
// in its loading state with data=null. We use this to verify the
// "Loading children…" placeholder is the SSR-safe first render and
// that the panel structure mounts correctly.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { StructureOverview } from '@/components/detail/StructureOverview'

describe('StructureOverview', () => {
  it('renders the panel container and loading row on first render', () => {
    const html = renderToString(
      React.createElement(StructureOverview, {
        nodeId: '00000000-0000-0000-0000-000000000001',
        onChildSelect: () => {},
      }),
    )
    expect(html).toMatch(/data-testid="structure-overview"/)
    expect(html).toMatch(/data-testid="children-panel"/)
    expect(html).toContain('Loading children')
  })

  it('children-panel uses neutral bg-elevated + border tokens (no verdigris)', () => {
    const html = renderToString(
      React.createElement(StructureOverview, {
        nodeId: '00000000-0000-0000-0000-000000000001',
        onChildSelect: () => {},
      }),
    )
    expect(html).toContain('var(--color-bg-elevated)')
    expect(html).toContain('var(--color-border-subtle)')
    // No verdigris in the StructureOverview-level chrome — NodeStatusBadge
    // children own the approved-status verdigris (use #5).
    expect(html).not.toMatch(/var\(--color-accent\)/)
  })
})
