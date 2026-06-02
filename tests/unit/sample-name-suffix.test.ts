// Phase 8.01.D T-11 — Sample novel suffix-numbering per OQ-3 locks.

import { describe, expect, it } from 'vitest'

import { pickNextSampleName } from '@/lib/samples/sampleNovel'

const BASE = 'Sample Novel — The Quiet Door'

describe('pickNextSampleName (OQ-3 1a + 2)', () => {
  it('no existing samples → base name', () => {
    expect(pickNextSampleName([])).toBe(BASE)
  })

  it('one existing (the base) → (2)', () => {
    expect(pickNextSampleName([BASE])).toBe(`${BASE} (2)`)
  })

  it('base + (2) → (3)', () => {
    expect(pickNextSampleName([BASE, `${BASE} (2)`])).toBe(`${BASE} (3)`)
  })

  it('lowest-available algo: base + (3) → (2) fills the gap', () => {
    expect(pickNextSampleName([BASE, `${BASE} (3)`])).toBe(`${BASE} (2)`)
  })

  it('reuse freed names: only (2) exists → base name is free', () => {
    expect(pickNextSampleName([`${BASE} (2)`])).toBe(BASE)
  })

  it('only (5) exists → base, then (2), then (3) ... base is lowest free', () => {
    expect(pickNextSampleName([`${BASE} (5)`])).toBe(BASE)
  })

  it('unrelated project names are ignored', () => {
    expect(
      pickNextSampleName(['My novel', 'Other thing', `${BASE} (2)`]),
    ).toBe(BASE)
  })

  it('malformed suffix is ignored (no match)', () => {
    expect(
      pickNextSampleName([BASE, `${BASE} (abc)`, `${BASE} (2)`]),
    ).toBe(`${BASE} (3)`)
  })
})
