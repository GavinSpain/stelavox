// Phase 8.01.E T-8 — DetailPaneCrumb render pinning.
//
// First-render (before useEffect resolves) for context nodes: should
// show the single bracketed label per OQ-4 lock (the context branch
// doesn't depend on the ancestor fetch). Structural nodes are loading-
// state-aware so first render shows just the leaf-segment bracketed
// label until ancestors arrive.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { DetailPaneCrumb } from '@/components/detail/DetailPaneCrumb'

describe('DetailPaneCrumb', () => {
  it('context node renders single bracketed [Character] label (OQ-4 lock)', () => {
    const html = renderToString(
      React.createElement(DetailPaneCrumb, {
        node: { id: 'x', node_type: 'character', node_category: 'context' },
        onSelectAncestor: () => {},
      }),
    )
    expect(html).toMatch(/data-testid="detail-crumb"/)
    expect(html).toMatch(/data-testid="detail-crumb-segment"/)
    expect(html).toMatch(/data-layer="character"/)
    // Non-tappable per spec — context nodes have no ancestor to navigate to.
    expect(html).toMatch(/data-tappable="false"/)
  })

  it('context node renders [Location] label for location type', () => {
    const html = renderToString(
      React.createElement(DetailPaneCrumb, {
        node: { id: 'x', node_type: 'location', node_category: 'context' },
        onSelectAncestor: () => {},
      }),
    )
    expect(html).toMatch(/data-layer="location"/)
  })

  it('structural root (first render, no ancestors yet) renders leaf-segment bracketed label', () => {
    const html = renderToString(
      React.createElement(DetailPaneCrumb, {
        node: { id: 'x', node_type: 'book', node_category: 'structural', order: 1 },
        onSelectAncestor: () => {},
      }),
    )
    // OQ-2 lock — leaf segment always present even when ancestor chain is empty.
    expect(html).toMatch(/data-testid="detail-crumb-segment"/)
    expect(html).toMatch(/data-layer="book"/)
    // Final segment is non-tappable per Phase 8.01.E lock.
    expect(html).toMatch(/data-tappable="false"/)
  })

  it('unknown structural node_type renders nothing on first render (defensive vs Phase 14 drift)', () => {
    // V1 layer-stack covers series/book/act/chapter/scene/beat. A Phase 14
    // layer type that isn't in the V1 set is intentionally not rendered
    // by the crumb at first render — we'd rather show nothing than a
    // misleading bracketed label. Ancestors may resolve later via the
    // useEffect, but that branch isn't covered by renderToString.
    const html = renderToString(
      React.createElement(DetailPaneCrumb, {
        node: { id: 'x', node_type: 'episode', node_category: 'structural', order: 2 },
        onSelectAncestor: () => {},
      }),
    )
    expect(html).toBe('')
  })
})
