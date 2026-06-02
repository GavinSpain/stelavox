/**
 * Inviolable #3 + #6 grep guards — Phase 8.01.A T-8.
 *
 * Walks the `components/` tree and asserts that:
 *  - Cinzel appears ONLY in `components/brand/` (the Wordmark + AppIcon).
 *  - Cormorant Garamond appears ONLY in `components/brand/` (the Wordmark
 *    via the `vox` span; AppIcon is Cinzel-only).
 *
 * Brand Identity v2.2 §3.7 explicitly lists "Cinzel never replaced /
 * Cormorant Garamond italic never replaced" — these are spec-locked.
 * The grep guard catches regressions where a refactor accidentally
 * spreads either typeface into the product UI (which would silently
 * dilute the brand mark).
 *
 * If this test fails on a new component, the fix is one of:
 *   1. Remove the typeface reference (Cinzel/Cormorant are wordmark-only).
 *   2. If the new use site IS a Wordmark/AppIcon variant, move it
 *      under components/brand/ where the test allows it.
 *   3. Spec-amend Brand Identity §12 Inviolable #3 or #6 (requires the
 *      version bump documented in §12 for any exception).
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const COMPONENTS_DIR = join(ROOT, 'components')
const BRAND_DIR = join(COMPONENTS_DIR, 'brand')

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) {
      walk(full, files)
    } else if (s.isFile() && (full.endsWith('.tsx') || full.endsWith('.ts'))) {
      files.push(full)
    }
  }
  return files
}

const ALL_COMPONENT_FILES = walk(COMPONENTS_DIR)

function isInBrandDir(file: string): boolean {
  return file.startsWith(BRAND_DIR)
}

function rel(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/')
}

describe('Inviolable #3 — Cinzel appears only in the wordmark', () => {
  it('no Cinzel reference outside components/brand/', () => {
    const offenders: string[] = []
    for (const file of ALL_COMPONENT_FILES) {
      if (isInBrandDir(file)) continue
      const text = readFileSync(file, 'utf-8')
      if (/[Cc]inzel/.test(text)) {
        offenders.push(rel(file))
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Inviolable #3 violation — Cinzel referenced outside components/brand/:\n  ` +
          offenders.join('\n  ') +
          `\nFix: remove the reference, or — if it is a Wordmark variant — move it into components/brand/.`,
      )
    }
    expect(offenders).toEqual([])
  })
})

describe('Inviolable #6 — Cormorant Garamond italic appears only in the wordmark', () => {
  it('no Cormorant Garamond reference outside components/brand/', () => {
    const offenders: string[] = []
    for (const file of ALL_COMPONENT_FILES) {
      if (isInBrandDir(file)) continue
      const text = readFileSync(file, 'utf-8')
      if (/Cormorant[ _]?Garamond|--font-cormorant/i.test(text)) {
        offenders.push(rel(file))
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Inviolable #6 violation — Cormorant Garamond referenced outside components/brand/:\n  ` +
          offenders.join('\n  ') +
          `\nFix: remove the reference, or — if it is a Wordmark variant — move it into components/brand/.`,
      )
    }
    expect(offenders).toEqual([])
  })
})

describe('Inviolable #3 + #6 — brand directory itself remains the canonical site', () => {
  it('components/brand/Wordmark.tsx references both Cinzel and Cormorant', () => {
    const wordmark = readFileSync(join(BRAND_DIR, 'Wordmark.tsx'), 'utf-8')
    expect(wordmark).toMatch(/Cinzel/)
    expect(wordmark).toMatch(/Cormorant/)
  })

  it('components/brand/AppIcon.tsx references Cinzel (the S in icon form)', () => {
    const appIcon = readFileSync(join(BRAND_DIR, 'AppIcon.tsx'), 'utf-8')
    expect(appIcon).toMatch(/Cinzel/)
  })
})
