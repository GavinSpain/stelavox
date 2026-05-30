/**
 * Wordmark — Phase 8.01.A T-8.
 *
 * Brand Identity v2.2 §3.2 / §3.3 / §3.4 — two-typeface mark with
 * verdigris gradient rule + 45°-rotated-square lozenge. Inviolables
 * #3 (Cinzel) and #6 (Cormorant Garamond italic) protect both
 * typefaces. Inviolable #2 brand verdigris uses #1 (lozenge) + #2 (rule).
 *
 * Tests assert: typography is present in both spans, the lozenge is a
 * rotated square (not a unicode glyph), the rule has a verdigris
 * gradient, both compact and hero sizes render distinct typography,
 * and `as="a"` renders an anchor with href.
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { Wordmark } from '@/components/brand/Wordmark'

describe('Wordmark', () => {
  it('renders the two-typeface mark (Stela + vox)', () => {
    const html = renderToString(React.createElement(Wordmark))
    expect(html).toContain('Stela')
    expect(html).toContain('vox')
    // Both spans have their data-testid hooks.
    expect(html).toMatch(/data-testid="wordmark-stela"/)
    expect(html).toMatch(/data-testid="wordmark-vox"/)
  })

  it('Stela uses Cinzel (Inviolable #3); vox uses Cormorant Garamond italic (Inviolable #6)', () => {
    const html = renderToString(React.createElement(Wordmark))
    // renderToString emits attributes in the order they're declared on the
    // element, so style="..." comes BEFORE data-testid="..." here. The
    // patterns match a <span> tag containing both fields in either order.
    expect(html).toMatch(/<span[^>]*Cinzel[^>]*data-testid="wordmark-stela"/i)
    expect(html).toMatch(/<span[^>]*Cormorant[^>]*data-testid="wordmark-vox"/i)
    expect(html).toMatch(/<span[^>]*italic[^>]*data-testid="wordmark-vox"/i)
  })

  it('lozenge is a 45°-rotated square with verdigris glow (Brand Identity §3.4, §3.7)', () => {
    const html = renderToString(React.createElement(Wordmark))
    expect(html).toMatch(/data-testid="wordmark-lozenge"/)
    // Rotation locks the diamond shape.
    expect(html).toMatch(/<span[^>]*rotate\(45deg\)[^>]*data-testid="wordmark-lozenge"/)
    // 8px verdigris glow per spec implementation note.
    expect(html).toMatch(/<span[^>]*box-shadow:0 0 8px rgba\(90,168,122,0\.45\)[^>]*data-testid="wordmark-lozenge"/)
    // Verdigris background — use #1 (lozenge).
    expect(html).toMatch(/<span[^>]*var\(--color-accent\)[^>]*data-testid="wordmark-lozenge"/)
  })

  it('rule has the verdigris-to-transparent gradient (Brand Identity §3.3)', () => {
    const html = renderToString(React.createElement(Wordmark))
    expect(html).toMatch(/data-testid="wordmark-rule"/)
    expect(html).toMatch(/linear-gradient\(90deg/)
    expect(html).toMatch(/<span[^>]*var\(--color-accent\)[^>]*data-testid="wordmark-rule"/)
    expect(html).toMatch(/transparent/)
  })

  it('compact size renders 17px Stela / 19px vox', () => {
    const html = renderToString(React.createElement(Wordmark, { size: 'compact' }))
    expect(html).toMatch(/data-testid="wordmark"[^>]*data-size="compact"/)
    // Stela 17px.
    expect(html).toMatch(/<span[^>]*font-size:17px[^>]*data-testid="wordmark-stela"/)
    // vox 19px.
    expect(html).toMatch(/<span[^>]*font-size:19px[^>]*data-testid="wordmark-vox"/)
  })

  it('hero size renders 42px Stela / 46px vox (with weight 300)', () => {
    const html = renderToString(React.createElement(Wordmark, { size: 'hero' }))
    expect(html).toMatch(/data-testid="wordmark"[^>]*data-size="hero"/)
    expect(html).toMatch(/<span[^>]*font-size:42px[^>]*data-testid="wordmark-stela"/)
    expect(html).toMatch(/<span[^>]*font-size:46px[^>]*data-testid="wordmark-vox"/)
    // OQ-1: 300 at hero per Brand Identity §3.2.
    expect(html).toMatch(/<span[^>]*font-weight:300[^>]*data-testid="wordmark-vox"/)
  })

  it('as="a" renders an anchor with href', () => {
    const html = renderToString(
      React.createElement(Wordmark, { as: 'a', href: '/dashboard' }),
    )
    expect(html).toMatch(/^<a[^>]+href="\/dashboard"/)
    expect(html).toMatch(/aria-label="Stelavox"/)
  })

  it('default renders a div, not an anchor', () => {
    const html = renderToString(React.createElement(Wordmark))
    expect(html).toMatch(/^<div/)
    expect(html).not.toMatch(/^<a/)
  })

  it('respects aria-label override', () => {
    const html = renderToString(
      React.createElement(Wordmark, { ariaLabel: 'Stelavox — home' }),
    )
    expect(html).toMatch(/aria-label="Stelavox — home"/)
  })
})
