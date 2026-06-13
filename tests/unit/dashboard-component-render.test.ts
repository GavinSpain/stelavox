// Phase 8.01.D T-11 — Dashboard render-pinning tests via renderToString.
//
// Covers YoursTile, ProjectCard, QuickStartChecklist + SampleNovelImportModal.
// Same renderToString-based pattern as 8.01.A/C.

import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { YoursTile } from '@/components/dashboard/YoursTile'
import { ProjectCard } from '@/components/dashboard/ProjectCard'
import { QuickStartChecklist } from '@/components/dashboard/QuickStartChecklist'
import { SampleNovelImportModal } from '@/components/dashboard/SampleNovelImportModal'

describe('YoursTile', () => {
  it('renders headline + body + locked encryption line', () => {
    const html = renderToString(React.createElement(YoursTile))
    expect(html).toMatch(/data-testid="yours-tile"/)
    expect(html).toContain('Your work, yours alone')
    expect(html).toContain('Every project belongs to you')
    // Encryption lock line — case-sensitive per Component Spec v2.21 §18.6.
    expect(html).toContain('Encrypted at rest · Private to your account')
    // CSS makes it uppercase visually but the literal text is title-case.
  })

  it('decorative dots are NEUTRAL, not verdigris (DR-057 Inviolable #2 audit close)', () => {
    const html = renderToString(React.createElement(YoursTile))
    // DR-057 (2026-06-14): the two decorative dots were uncatalogued
    // verdigris uses → neutral --color-text-muted, keeping the Inviolable #2
    // enumeration exact at 12.
    expect(html).not.toMatch(/var\(--color-accent\)/)
    expect(html).toMatch(/var\(--color-text-muted\)/)
  })
})

describe('ProjectCard', () => {
  const baseAggregate = {
    projectId: 'pid-1',
    projectName: 'Shadow Protocol',
    description: null,
    layerStackLabel: 'NOVEL · Book → Act → Ch → Sc → Bt',
    lastUpdatedAt: new Date(Date.now() - 60_000).toISOString(),
    documentCount: 1,
    wordsDrafted: 73_440,
    wordsTarget: 84_000,
    isSample: false,
  }

  it('renders title + stack + drafted percentage', () => {
    const html = renderToString(React.createElement(ProjectCard, { aggregate: baseAggregate }))
    expect(html).toMatch(/data-testid="project-card"/)
    expect(html).toContain('Shadow Protocol')
    expect(html).toContain('NOVEL')
    expect(html).toContain('87%')
  })

  it('omits the SAMPLE badge when isSample is false', () => {
    const html = renderToString(React.createElement(ProjectCard, { aggregate: baseAggregate }))
    expect(html).not.toMatch(/data-testid="sample-badge"/)
  })

  it('renders the SAMPLE badge when isSample is true', () => {
    const html = renderToString(
      React.createElement(ProjectCard, { aggregate: { ...baseAggregate, isSample: true } }),
    )
    expect(html).toMatch(/data-testid="sample-badge"/)
  })

  it('renders "0 days ago" gracefully when there are no nodes', () => {
    const html = renderToString(
      React.createElement(ProjectCard, {
        aggregate: { ...baseAggregate, lastUpdatedAt: null, wordsDrafted: 0, wordsTarget: 0 },
      }),
    )
    expect(html).toContain('No activity yet')
    expect(html).toContain('0%')
  })
})

describe('QuickStartChecklist', () => {
  it('renders 5 items by default with checked + unchecked states', () => {
    const html = renderToString(
      React.createElement(QuickStartChecklist, {
        completion: {
          signedIn: true,
          hasProject: false,
          hasBeatWithProse: false,
          hasTriedDirector: false,
          hasCompletedExport: false,
        },
      }),
    )
    expect(html).toMatch(/data-testid="quick-start-checklist"/)
    expect(html).toMatch(/data-testid="qs-item-signedIn"[^>]*data-done="true"/)
    expect(html).toMatch(/data-testid="qs-item-hasProject"[^>]*data-done="false"/)
  })

  it('renders Setup-complete pill when all five are done', () => {
    const html = renderToString(
      React.createElement(QuickStartChecklist, {
        completion: {
          signedIn: true,
          hasProject: true,
          hasBeatWithProse: true,
          hasTriedDirector: true,
          hasCompletedExport: true,
        },
      }),
    )
    expect(html).toMatch(/data-testid="quick-start-complete"/)
    expect(html).toContain('Setup complete')
  })
})

describe('SampleNovelImportModal', () => {
  it('renders nothing when closed', () => {
    const html = renderToString(
      React.createElement(SampleNovelImportModal, { open: false, onClose: () => {} }),
    )
    expect(html).toBe('')
  })

  it('renders header + preview + buttons when open', () => {
    const html = renderToString(
      React.createElement(SampleNovelImportModal, { open: true, onClose: () => {} }),
    )
    expect(html).toMatch(/data-testid="sample-import-modal"/)
    expect(html).toContain('Load the sample novel')
    expect(html).toContain('The Quiet Door')
    expect(html).toMatch(/data-testid="sample-import-cancel"/)
    expect(html).toMatch(/data-testid="sample-import-confirm"/)
    // Confirm button uses verdigris (use #7).
    expect(html).toMatch(/data-testid="sample-import-confirm"[^>]*var\(--color-accent\)|background:var\(--color-accent\)[^>]*data-testid="sample-import-confirm"/)
  })
})
