/**
 * Unit tests for the workflow_executor's auto-create-context-node logic
 * (SU-J11-2 / Option B fix).
 *
 * The full integration path (insert + link + re-target + dispatch) is
 * exercised by the cloud-bug regression smoke; these unit tests pin the
 * pure name-derivation helper.
 */

import { describe, expect, it } from 'vitest'

import { deriveContextName } from '@/lib/director/workflow-executor'

describe('deriveContextName', () => {
  it('returns capitalized context type when seed_content is empty', () => {
    expect(deriveContextName('theme', '')).toBe('Theme')
    expect(deriveContextName('world', '')).toBe('World')
    expect(deriveContextName('character', '   ')).toBe('Character')
    expect(deriveContextName('plot_thread', '')).toBe('Plot_thread')
  })

  it('extracts first non-empty line from seed_content', () => {
    expect(deriveContextName('theme', 'Ambition and hubris\n\nDriving force')).toBe('Ambition and hubris')
    expect(deriveContextName('world', '\n\nHard physics\n\nMore detail')).toBe('Hard physics')
  })

  it('strips markdown header markers', () => {
    expect(deriveContextName('theme', '# Core Themes\n\nDetails')).toBe('Core Themes')
    expect(deriveContextName('theme', '### Theme Title\n\nMore')).toBe('Theme Title')
  })

  it('strips numeric list prefixes', () => {
    expect(deriveContextName('theme', '1. Ambition & Hubris\n2. Belonging')).toBe('Ambition & Hubris')
    expect(deriveContextName('world', '12. Logistics framework')).toBe('Logistics framework')
  })

  it('strips bullet list prefixes', () => {
    expect(deriveContextName('theme', '- Ambition\n- Belonging')).toBe('Ambition')
    expect(deriveContextName('world', '* Hard physics')).toBe('Hard physics')
  })

  it('strips trailing colons (heading style)', () => {
    expect(deriveContextName('world', 'HARD PHYSICS & LOGISTICS:\n\nDetails')).toBe('Hard Physics & Logistics')
  })

  it('title-cases purely ALL-CAPS first lines', () => {
    // "AMBITION AND HUBRIS" is fully uppercase → title-cases.
    expect(deriveContextName('theme', 'AMBITION AND HUBRIS')).toBe('Ambition And Hubris')
    // "CORE WORLD" with trailing colon — colon stripped, then title-cased.
    expect(deriveContextName('world', 'CORE WORLD:\n\nMars colonization')).toBe('Core World')
  })

  it('preserves mixed-case strings (no title-case-overreach)', () => {
    // Not all uppercase → not title-cased → return as-is.
    expect(deriveContextName('world', 'CORE WORLD: Mars colonization')).toBe('CORE WORLD: Mars colonization')
  })

  it('preserves mixed-case lines', () => {
    expect(deriveContextName('theme', 'Ambition and Hubris drive everything')).toBe('Ambition and Hubris drive everything')
  })

  it('truncates names longer than 80 chars', () => {
    const longLine = 'A very long opening sentence that runs on far past the typical name length we expect for a context node'
    const result = deriveContextName('theme', longLine)
    expect(result.length).toBeLessThanOrEqual(81) // 77 + '…'
    expect(result.endsWith('…')).toBe(true)
  })

  it('falls back to context type if first line is empty after stripping', () => {
    expect(deriveContextName('theme', '#\n\nMore')).toBe('Theme')
    expect(deriveContextName('world', '1.\n\nMore')).toBe('World')
  })

  it('handles the actual Mars-series seed_content (theme + world)', () => {
    // Real seed_content from cloud workflow db0874ed step 2
    const themeSeed =
      'This series explores six interlocking themes across 30–40 years:\n\n' +
      "1. AMBITION & HUBRIS: Humanity's drive to colonize space..."
    expect(deriveContextName('theme', themeSeed)).toBe('This series explores six interlocking themes across 30–40 years')

    // Real seed_content from cloud workflow db0874ed step 3
    const worldSeed = 'HARD PHYSICS & LOGISTICS:\n\n1. GRAVITY WELLS: Earth\'s gravity...'
    expect(deriveContextName('world', worldSeed)).toBe('Hard Physics & Logistics')
  })
})
