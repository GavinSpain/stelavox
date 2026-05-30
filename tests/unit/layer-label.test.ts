/**
 * LayerLabel — Phase 8.01.A T-8.
 *
 * Universal bracketed monospace label per Component Spec v2.21 §18.1.
 * Tests the abbreviation map, the position-rendering policy, the
 * data-testid hooks, and the defensive fallback for unknown layers.
 *
 * Render strategy: react-dom/server renderToString — matches the
 * existing project convention (no jsdom / React Testing Library wired).
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { LAYER_ABBR, LayerLabel, type LayerKind } from '@/components/tree/LayerLabel'

describe('LAYER_ABBR map', () => {
  it('covers all six V1 structural kinds', () => {
    expect(LAYER_ABBR).toEqual({
      series: 'Series',
      book: 'Book',
      act: 'Act',
      chapter: 'Ch',
      scene: 'Sc',
      beat: 'Bt',
    })
  })
})

describe('LayerLabel — rendered output', () => {
  it.each<{ layer: LayerKind; position: number; expected: string }>([
    { layer: 'book',    position: 1,  expected: '[Book 1]' },
    { layer: 'act',     position: 1,  expected: '[Act 1]' },
    { layer: 'chapter', position: 1,  expected: '[Ch 1]' },
    { layer: 'scene',   position: 1,  expected: '[Sc 1]' },
    { layer: 'beat',    position: 1,  expected: '[Bt 1]' },
    { layer: 'beat',    position: 12, expected: '[Bt 12]' }, // double-digit
  ])('renders $layer/$position as $expected', ({ layer, position, expected }) => {
    const html = renderToString(React.createElement(LayerLabel, { layer, position }))
    expect(html).toContain(expected)
  })

  it('series renders without position number', () => {
    const html = renderToString(React.createElement(LayerLabel, { layer: 'series', position: 1 }))
    expect(html).toContain('[Series]')
    expect(html).not.toContain('[Series 1]')
  })

  it('series with position omitted still renders [Series]', () => {
    const html = renderToString(React.createElement(LayerLabel, { layer: 'series' }))
    expect(html).toContain('[Series]')
  })

  it('data-testid and data attributes are emitted', () => {
    const html = renderToString(React.createElement(LayerLabel, { layer: 'chapter', position: 3 }))
    expect(html).toMatch(/data-testid="layer-label"/)
    expect(html).toMatch(/data-layer="chapter"/)
    expect(html).toMatch(/data-position="3"/)
  })

  it('typography uses monospace family', () => {
    const html = renderToString(React.createElement(LayerLabel, { layer: 'beat', position: 1 }))
    expect(html).toMatch(/monospace/i)
  })

  it('uses the neutral default border token, not verdigris (Inviolable #2)', () => {
    const html = renderToString(React.createElement(LayerLabel, { layer: 'beat', position: 1 }))
    expect(html).toContain('var(--color-border-default)')
    expect(html).not.toContain('var(--color-accent)')
    expect(html).not.toContain('#3d7858')
  })

  it('unknown layer falls back to title-cased string (defensive)', () => {
    // Cast bypasses the LayerKind constraint to simulate a Phase-14 future
    // node_type. Spec §18.1 says clients route through this component;
    // the fallback ensures no missing-label rendering during migration.
    const html = renderToString(
      React.createElement(LayerLabel, {
        layer: 'episode' as unknown as LayerKind,
        position: 7,
      }),
    )
    expect(html).toContain('[Episode 7]')
  })

  it('accepts className prop without breaking core styles', () => {
    const html = renderToString(
      React.createElement(LayerLabel, {
        layer: 'beat',
        position: 1,
        className: 'extra-class',
      }),
    )
    expect(html).toContain('class="extra-class"')
    // Core spec style still present.
    expect(html).toContain('monospace')
  })
})
