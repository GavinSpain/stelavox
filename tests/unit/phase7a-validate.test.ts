/**
 * Phase 7.A unit tests — pre-render validation.
 *
 * Pure-function tests; no DB needed.
 */

import { describe, expect, it } from 'vitest'
import { validateForExport } from '@/lib/export/validate'

const STANDARD_LIMITS = {
  soft_warning_words: 900_000,
  max_words_per_document: 1_500_000,
  max_chapters_per_document: 500,
  max_render_minutes: 4,
  max_file_size_mb: 50,
}

describe('Phase 7.A validate', () => {
  it('small document — no warnings or errors', () => {
    const r = validateForExport(
      { total_words: 80_000, total_chapters: 25, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings).toEqual([])
    expect(r.errors).toEqual([])
    expect(r.estimated_pages).toBeGreaterThan(0)
  })

  it('soft warning at 3,000+ pages for DOCX', () => {
    // 3000 pages × 250 words/page = 750,000 — over soft_warning_words
    const r = validateForExport(
      { total_words: 950_000, total_chapters: 75, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBe(1)
    expect(r.warnings[0]).toMatch(/large/i)
  })

  it('soft warning at 3,000+ pages for EPUB', () => {
    const r = validateForExport(
      { total_words: 950_000, total_chapters: 75, format: 'epub' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings.length).toBe(1)
  })

  it('hard fail at DOCX max with EPUB fallback suggested', () => {
    const r = validateForExport(
      { total_words: 1_600_000, total_chapters: 200, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.length).toBeGreaterThanOrEqual(1)
    expect(r.errors[0]).toMatch(/exceeds the DOCX export limit/)
    expect(r.errors[0]).toMatch(/EPUB is recommended/)
    expect(r.suggested_fallback).toBe('epub')
  })

  it('beyond EPUB ceiling — no fallback; split-document message', () => {
    const r = validateForExport(
      { total_words: 5_000_000, total_chapters: 600, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(false)
    expect(r.suggested_fallback).toBeUndefined()
  })

  it('EPUB at its own ceiling (~15,000 pages)', () => {
    const r = validateForExport(
      { total_words: 5_000_000, total_chapters: 400, format: 'epub' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors[0]).toMatch(/exceeds the EPUB export limit/)
  })

  it('chapter cap enforced across formats', () => {
    const r = validateForExport(
      { total_words: 50_000, total_chapters: 501, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some(e => /chapters/i.test(e))).toBe(true)
  })

  it('JSON and outline never produce soft warnings (they are fast)', () => {
    for (const format of ['json', 'outline'] as const) {
      const r = validateForExport(
        { total_words: 950_000, total_chapters: 75, format },
        STANDARD_LIMITS,
      )
      expect(r.warnings).toEqual([])
    }
  })

  it('estimates make sense', () => {
    const r = validateForExport(
      { total_words: 100_000, total_chapters: 30, format: 'docx' },
      STANDARD_LIMITS,
    )
    expect(r.estimated_pages).toBe(400)        // 100k / 250 wpp
    expect(r.estimated_seconds).toBeGreaterThan(0)
    expect(r.estimated_seconds).toBeLessThan(120)  // ~33s at 3000 wps
    expect(r.estimated_size_mb).toBeGreaterThanOrEqual(0)
  })
})
