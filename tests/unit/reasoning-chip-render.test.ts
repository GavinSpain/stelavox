// Phase 8.01.C T-9 — ReasoningChip render contract.
//
// Uses react-dom/server renderToString — matches the 8.01.A Wordmark /
// LayerLabel test pattern. Covers the collapsed render (default),
// line-count display, neutral border + bg, and data-testid hooks.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { ReasoningChip } from '@/components/director/ReasoningChip'

describe('ReasoningChip', () => {
  it('renders nothing when text is empty', () => {
    const html = renderToString(React.createElement(ReasoningChip, { text: '' }))
    expect(html).toBe('')
  })

  it('default state is collapsed with the line count', () => {
    const text = 'line one\nline two\nline three'
    const html = renderToString(React.createElement(ReasoningChip, { text }))
    expect(html).toMatch(/data-testid="reasoning-chip"/)
    expect(html).toMatch(/data-state="collapsed"/)
    expect(html).toMatch(/data-line-count="3"/)
    // React inserts <!-- --> comment markers between text + variable
    // children — match each token individually to avoid coupling to that.
    expect(html).toContain('Reasoning · ')
    expect(html).toContain('>3<')
    expect(html).toContain('lines')
  })

  it('single-line uses singular noun', () => {
    const html = renderToString(React.createElement(ReasoningChip, { text: 'just one' }))
    expect(html).toContain('Reasoning · ')
    expect(html).toContain('>1<')
    expect(html).toContain('line')
  })

  it('uses neutral border + bg tokens (no verdigris)', () => {
    const html = renderToString(React.createElement(ReasoningChip, { text: 'x' }))
    expect(html).toContain('var(--color-bg-elevated)')
    expect(html).toContain('var(--color-border-subtle)')
    expect(html).not.toContain('var(--color-accent)')
    expect(html).not.toContain('#3d7858')
  })

  it('uses monospace font family', () => {
    const html = renderToString(React.createElement(ReasoningChip, { text: 'x' }))
    expect(html).toMatch(/monospace/i)
  })

  it('button carries aria-expanded=false in default state', () => {
    const html = renderToString(React.createElement(ReasoningChip, { text: 'x' }))
    expect(html).toMatch(/aria-expanded="false"/)
  })
})
