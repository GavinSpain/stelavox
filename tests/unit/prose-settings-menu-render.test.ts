/**
 * Phase 8.8 unit — ProseSettingsMenu closed-state render.
 *
 * Verifies the trigger button shell + variant attribute via renderToString
 * (codebase convention — no DOM, no testing-library). The dropdown's
 * open behaviour, toggle clicks, Escape, and outside-click are covered
 * by manual verification per the wireframe; the closed-state contract
 * here is the structural guard.
 */

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { ProseSettingsMenu } from '@/components/detail/ProseSettingsMenu'

describe('ProseSettingsMenu — closed-state shell', () => {
  it('renders the trigger button with the closed-state ARIA attributes', () => {
    const html = renderToString(React.createElement(ProseSettingsMenu))
    expect(html).toMatch(/data-testid="prose-settings-menu"/)
    expect(html).toMatch(/data-testid="prose-settings-trigger"/)
    // Closed by default.
    expect(html).toMatch(/aria-expanded="false"/)
    expect(html).toMatch(/aria-haspopup="menu"/)
    expect(html).toMatch(/aria-label="Prose settings"/)
    // The dropdown is absent when closed.
    expect(html).not.toMatch(/data-testid="prose-settings-dropdown"/)
  })

  it('exposes the variant on the wrapper for downstream styling', () => {
    const editHtml = renderToString(React.createElement(ProseSettingsMenu))
    expect(editHtml).toMatch(/data-variant="edit"/)

    const focusHtml = renderToString(
      React.createElement(ProseSettingsMenu, { variant: 'focus' }),
    )
    expect(focusHtml).toMatch(/data-variant="focus"/)
  })

  it('renders the ⋯ glyph (three-dot indicator)', () => {
    const html = renderToString(React.createElement(ProseSettingsMenu))
    expect(html).toContain('⋯')
  })

  it('uses no verdigris on the closed-state trigger (Inviolable #2)', () => {
    const html = renderToString(React.createElement(ProseSettingsMenu))
    // The closed state should reference only neutral border/text tokens
    // — --color-accent must not appear at all in the trigger chrome.
    expect(html).not.toContain('--color-accent')
  })

  it('Focus Mode variant starts at idle opacity (≤ 0.35)', () => {
    // The fade-on-idle behaviour kicks in at variant='focus' with no
    // hover/focus/open state. We can't read computed styles via
    // renderToString, but the inline style string is in the markup.
    const html = renderToString(
      React.createElement(ProseSettingsMenu, { variant: 'focus' }),
    )
    expect(html).toMatch(/opacity:0\.35/)
  })

  it('Edit Mode variant renders at full opacity', () => {
    const html = renderToString(React.createElement(ProseSettingsMenu))
    expect(html).toMatch(/opacity:1/)
  })
})
