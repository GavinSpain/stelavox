// Phase 8.01 wireframe-alignment round 1 — render tests for the
// ProjectDocumentsTab presentation pieces + helpers.
//
// What this guards:
//   - Inviolable #2 use #10 (ordinal tile colours)
//   - Inviolable #2 use #11 (stack-tag chip colours; both small and
//     larger badge variants share the same color tokens)
//   - The pretty-printer for document_type stack labels
//   - The "last active" / "last edit" relative-time formatter
//
// What's NOT covered here:
//   - Full <ProjectDocumentsTab> render — depends on next/navigation's
//     useRouter, which isn't easily exercised in a renderToString
//     environment. Playwright + the existing live verification cover
//     the end-to-end shape.
//   - DocumentMenu interactions — unchanged in this round.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { OrdinalTile, StackTag } from '@/components/project/ProjectDocumentsTab'
import {
  prettyDocumentType,
  formatLastActive,
} from '@/app/(app)/projects/[projectId]/_ProjectPageClient'

describe('prettyDocumentType', () => {
  it('handles snake_case multi-word types', () => {
    expect(prettyDocumentType('series_of_novels')).toBe('Series Of Novels')
    expect(prettyDocumentType('short_story')).toBe('Short Story')
  })

  it('handles single-word types', () => {
    expect(prettyDocumentType('novel')).toBe('Novel')
  })

  it('falls back to "Document" on null / undefined / empty', () => {
    expect(prettyDocumentType(null)).toBe('Document')
    expect(prettyDocumentType(undefined)).toBe('Document')
    expect(prettyDocumentType('')).toBe('Document')
  })

  it('ignores extra underscores defensively', () => {
    expect(prettyDocumentType('__novel__')).toBe('Novel')
  })
})

describe('formatLastActive', () => {
  function isoMinusSeconds(s: number): string {
    return new Date(Date.now() - s * 1000).toISOString()
  }

  it('renders "just now" for < 60s', () => {
    expect(formatLastActive(isoMinusSeconds(10))).toBe('last active just now')
  })

  it('renders minutes for < 1h', () => {
    expect(formatLastActive(isoMinusSeconds(60 * 5))).toBe('last active 5m ago')
  })

  it('renders hours for < 24h', () => {
    expect(formatLastActive(isoMinusSeconds(60 * 60 * 3))).toBe('last active 3h ago')
  })

  it('renders days for < 7d', () => {
    expect(formatLastActive(isoMinusSeconds(60 * 60 * 24 * 3))).toBe('last active 3d ago')
  })

  it('renders weeks for < 30d', () => {
    expect(formatLastActive(isoMinusSeconds(60 * 60 * 24 * 14))).toBe('last active 2w ago')
  })

  it('renders months for >= 30d', () => {
    expect(formatLastActive(isoMinusSeconds(60 * 60 * 24 * 45))).toBe('last active 1mo ago')
  })

  it('returns null for null / undefined / unparseable input', () => {
    expect(formatLastActive(null)).toBeNull()
    expect(formatLastActive(undefined)).toBeNull()
    expect(formatLastActive('not-an-iso')).toBeNull()
  })
})

describe('OrdinalTile — Inviolable #2 use #10', () => {
  it('renders the supplied ordinal digit', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 7 }))
    expect(html).toContain('>7<')
  })

  it('has data-testid hook for downstream Playwright assertions', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 1 }))
    expect(html).toMatch(/data-testid="document-row-ordinal"/)
  })

  it('background uses --color-accent-muted (use #10 spec lock)', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 1 }))
    expect(html).toContain('background:var(--color-accent-muted)')
  })

  it('digit colour uses --color-accent-hover (use #10 spec lock)', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 1 }))
    expect(html).toContain('color:var(--color-accent-hover)')
  })

  it('exactly 36x36 with monospace digit per wireframe', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 1 }))
    expect(html).toContain('width:36px')
    expect(html).toContain('height:36px')
    // React-rendered inline-style font-family uses HTML-entity-escaped
    // quotes (`&quot;`) which contain literal `;` chars — so we assert
    // the salient tokens without binding their relationship in a single
    // regex.
    expect(html).toContain('font-family:ui-monospace')
    expect(html).toContain('JetBrains Mono')
  })

  it('marked aria-hidden — the ordinal is decorative, not a labelled affordance', () => {
    const html = renderToString(React.createElement(OrdinalTile, { ordinal: 1 }))
    expect(html).toMatch(/aria-hidden="true"/)
  })
})

describe('StackTag — Inviolable #2 use #11', () => {
  it('pretty-prints the document_type', () => {
    const html = renderToString(React.createElement(StackTag, { documentType: 'series_of_novels' }))
    expect(html).toContain('Series Of Novels')
  })

  it('has data-testid hook', () => {
    const html = renderToString(React.createElement(StackTag, { documentType: 'novel' }))
    expect(html).toMatch(/data-testid="document-row-stack-tag"/)
  })

  it('text colour uses --color-accent-hover (use #11 spec lock)', () => {
    const html = renderToString(React.createElement(StackTag, { documentType: 'novel' }))
    expect(html).toContain('color:var(--color-accent-hover)')
  })

  it('border uses --color-accent-hover at 35% alpha (use #11 chip border)', () => {
    const html = renderToString(React.createElement(StackTag, { documentType: 'novel' }))
    // color-mix with --color-accent-hover at 35% via the inline style
    expect(html).toMatch(/border:[^;]*color-mix\(in srgb, var\(--color-accent-hover\) 35%/)
  })

  it('uses monospace typography for the chip text', () => {
    const html = renderToString(React.createElement(StackTag, { documentType: 'novel' }))
    expect(html).toContain('font-family:ui-monospace')
    expect(html).toContain('JetBrains Mono')
  })
})
