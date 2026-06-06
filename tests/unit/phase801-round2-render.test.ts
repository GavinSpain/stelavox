// Phase 8.01 wireframe-alignment round 2 — render tests for the new
// components introduced in the comprehensive aesthetic pass.
//
// Covers:
//   - SearchChip (Inter 11px chip + monospace ⌘K hint)
//   - UserMenu.deriveIdentity (helper)
//   - DirectorMark + DirectorLabel (Inviolable #3 v2.4 site)
//   - DocumentTitleStrip (pretty type + relative time helpers)
//   - FilterChipsRow (chip shape + deferred banner)
//   - NodeRow.LAYER_NAME_TYPOGRAPHY map (per-layer hierarchy)
//
// Live integration is verified separately via preview_eval.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { SearchChip } from '@/components/layout/SearchChip'
import { deriveIdentity } from '@/components/layout/UserMenu'
import { DirectorMark, DirectorLabel } from '@/components/director/DirectorMark'
import {
  DocumentTitleStrip,
  prettyType,
  formatRelative,
} from '@/components/tree/DocumentTitleStrip'
import { FilterChipsRow } from '@/components/tree/FilterChipsRow'
import { LAYER_NAME_TYPOGRAPHY } from '@/components/tree/NodeRow'

// ─────────────────────────────────────────────────────────────────────
describe('SearchChip', () => {
  it('renders a button with Search label and ⌘K hint', () => {
    const html = renderToString(React.createElement(SearchChip))
    expect(html).toMatch(/data-testid="header-search-chip"/)
    expect(html).toContain('Search')
    expect(html).toMatch(/data-testid="header-search-kbd"/)
    expect(html).toContain('⌘K')
  })

  it('respects a custom label', () => {
    const html = renderToString(React.createElement(SearchChip, { label: 'Find' }))
    expect(html).toContain('Find')
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('UserMenu.deriveIdentity', () => {
  it('derives a single-word identity from a plain local-part', () => {
    expect(deriveIdentity('author@stelavox.local')).toEqual({
      displayName: 'Author',
      initials: 'A',
    })
  })

  it('splits dotted local-parts and takes first letters', () => {
    expect(deriveIdentity('gavin.spain@example.com')).toEqual({
      displayName: 'Gavin Spain',
      initials: 'GS',
    })
  })

  it('treats underscores and dashes the same as dots', () => {
    expect(deriveIdentity('acme_admin@x.io')).toEqual({
      displayName: 'Acme Admin',
      initials: 'AA',
    })
    expect(deriveIdentity('ada-lovelace@example.com')).toEqual({
      displayName: 'Ada Lovelace',
      initials: 'AL',
    })
  })

  it('caps initials at two letters even when local has more parts', () => {
    expect(deriveIdentity('one.two.three.four@example.com').initials).toBe('OT')
  })

  it('falls back gracefully on garbage input', () => {
    expect(deriveIdentity('@@@')).toEqual({ displayName: '?', initials: '?' })
    expect(deriveIdentity('')).toEqual({ displayName: '?', initials: '?' })
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('DirectorMark — Inviolable #3 v2.4 brand-mark site', () => {
  it('renders a 32×32 gradient square by default', () => {
    const html = renderToString(React.createElement(DirectorMark))
    expect(html).toMatch(/data-testid="director-mark"/)
    expect(html).toContain('width:32px')
    expect(html).toContain('height:32px')
  })

  it('respects a custom size', () => {
    const html = renderToString(React.createElement(DirectorMark, { size: 24 }))
    expect(html).toContain('width:24px')
    expect(html).toContain('height:24px')
  })

  it('uses Cinzel for the inner glyph', () => {
    const html = renderToString(React.createElement(DirectorMark))
    expect(html).toContain('font-family:Cinzel')
  })

  it('has verdigris gradient background', () => {
    const html = renderToString(React.createElement(DirectorMark))
    expect(html).toContain('linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)')
  })

  it('DirectorLabel renders "Director" in Cinzel', () => {
    const html = renderToString(React.createElement(DirectorLabel))
    expect(html).toMatch(/data-testid="director-label"/)
    expect(html).toContain('Director')
    expect(html).toContain('font-family:Cinzel')
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('DocumentTitleStrip helpers', () => {
  it('prettyType handles known + unknown shapes', () => {
    expect(prettyType('novel')).toBe('Novel')
    expect(prettyType('series_of_novels')).toBe('Series Of Novels')
    expect(prettyType(null)).toBe('Document')
    expect(prettyType('')).toBe('Document')
  })

  it('formatRelative returns null on null/garbage', () => {
    expect(formatRelative(null)).toBeNull()
    expect(formatRelative('not-an-iso')).toBeNull()
  })

  it('formatRelative scales: seconds → minutes → hours → days → weeks → months', () => {
    const minus = (s: number) => new Date(Date.now() - s * 1000).toISOString()
    expect(formatRelative(minus(10))).toBe('just now')
    expect(formatRelative(minus(60 * 5))).toBe('5 min ago')
    expect(formatRelative(minus(60 * 60 * 3))).toBe('3h ago')
    expect(formatRelative(minus(60 * 60 * 24 * 4))).toBe('4d ago')
    expect(formatRelative(minus(60 * 60 * 24 * 14))).toBe('2w ago')
    expect(formatRelative(minus(60 * 60 * 24 * 60))).toBe('2mo ago')
  })
})

describe('DocumentTitleStrip render', () => {
  function render(props: Partial<Parameters<typeof DocumentTitleStrip>[0]> = {}) {
    return renderToString(
      React.createElement(DocumentTitleStrip, {
        projectId: 'p1',
        projectName: 'Shadow Protocol',
        documentName: 'Shadow Protocol',
        documentType: 'novel',
        documentUpdatedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        ...props,
      }),
    )
  }

  it('renders breadcrumb + title + stack-badge + meta hooks', () => {
    const html = render()
    expect(html).toMatch(/data-testid="document-breadcrumb"/)
    expect(html).toMatch(/data-testid="document-title"/)
    expect(html).toMatch(/data-testid="document-stack-badge"/)
    expect(html).toMatch(/data-testid="document-meta"/)
  })

  it('stack badge uses Inviolable #2 use #11 colour (--color-accent-hover)', () => {
    const html = render()
    expect(html).toMatch(
      /<span[^>]*data-testid="document-stack-badge"[^>]*style="[^"]*color:var\(--color-accent-hover\)/,
    )
  })

  it('title is 16px / weight 600', () => {
    const html = render()
    expect(html).toMatch(
      /<h1[^>]*data-testid="document-title"[^>]*style="[^"]*font-size:16px[^"]*font-weight:600/,
    )
  })

  it('omits the meta line when updated_at is null', () => {
    const html = render({ documentUpdatedAt: null })
    expect(html).not.toMatch(/last edit/)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('FilterChipsRow', () => {
  it('renders the four spec-locked chips + deferred banner + Find box', () => {
    const html = renderToString(React.createElement(FilterChipsRow, { totalNodes: 114 }))
    expect(html).toMatch(/data-testid="filter-chip-all"/)
    expect(html).toMatch(/data-testid="filter-chip-incomplete"/)
    expect(html).toMatch(/data-testid="filter-chip-pending-review"/)
    expect(html).toMatch(/data-testid="filter-chip-running"/)
    expect(html).toMatch(/data-testid="filter-deferred-banner"/)
    expect(html).toMatch(/data-testid="filter-find-box"/)
    expect(html).toContain('114') // All chip count
    expect(html).toContain('⌘F')
  })

  it('All chip is active by default', () => {
    const html = renderToString(React.createElement(FilterChipsRow))
    expect(html).toMatch(/<button[^>]*data-testid="filter-chip-all"[^>]*data-active="true"/)
  })

  it('other chips are inactive (disabled placeholders for Phase 8.03)', () => {
    const html = renderToString(React.createElement(FilterChipsRow))
    expect(html).toMatch(/<button[^>]*data-testid="filter-chip-incomplete"[^>]*data-active="false"/)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('NodeRow LAYER_NAME_TYPOGRAPHY map', () => {
  it('uses the wireframe-locked sizes (Series 15 → Beat 12)', () => {
    expect(LAYER_NAME_TYPOGRAPHY.series.fontSize).toBe(15)
    expect(LAYER_NAME_TYPOGRAPHY.book.fontSize).toBe(14.5)
    expect(LAYER_NAME_TYPOGRAPHY.act.fontSize).toBe(13.5)
    expect(LAYER_NAME_TYPOGRAPHY.chapter.fontSize).toBe(13)
    expect(LAYER_NAME_TYPOGRAPHY.scene.fontSize).toBe(12.5)
    expect(LAYER_NAME_TYPOGRAPHY.beat.fontSize).toBe(12)
  })

  it('uses the wireframe-locked weights (Book/Series 600 → Beat 300)', () => {
    expect(LAYER_NAME_TYPOGRAPHY.series.fontWeight).toBe(600)
    expect(LAYER_NAME_TYPOGRAPHY.book.fontWeight).toBe(600)
    expect(LAYER_NAME_TYPOGRAPHY.act.fontWeight).toBe(500)
    expect(LAYER_NAME_TYPOGRAPHY.chapter.fontWeight).toBe(500)
    expect(LAYER_NAME_TYPOGRAPHY.scene.fontWeight).toBe(400)
    expect(LAYER_NAME_TYPOGRAPHY.beat.fontWeight).toBe(300)
  })

  it('Book + Series get text-primary; Scene + Beat get text-secondary', () => {
    expect(LAYER_NAME_TYPOGRAPHY.book.color).toBe('var(--color-text-primary)')
    expect(LAYER_NAME_TYPOGRAPHY.series.color).toBe('var(--color-text-primary)')
    expect(LAYER_NAME_TYPOGRAPHY.scene.color).toBe('var(--color-text-secondary)')
    expect(LAYER_NAME_TYPOGRAPHY.beat.color).toBe('var(--color-text-secondary)')
  })
})
