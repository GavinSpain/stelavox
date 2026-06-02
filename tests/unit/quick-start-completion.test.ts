// Phase 8.01.D T-11 — QuickStart completion helper logic.

import { describe, expect, it } from 'vitest'

import {
  countCompleted,
  allComplete,
  QUICK_START_ITEM_IDS,
  type QuickStartCompletion,
} from '@/lib/dashboard/quickStartCompletion'

function partial(overrides: Partial<QuickStartCompletion>): QuickStartCompletion {
  return {
    signedIn: true,
    hasProject: false,
    hasBeatWithProse: false,
    hasTriedDirector: false,
    hasCompletedExport: false,
    ...overrides,
  }
}

describe('countCompleted', () => {
  it('signed-in only → 1', () => {
    expect(countCompleted(partial({}))).toBe(1)
  })

  it('one extra milestone → 2', () => {
    expect(countCompleted(partial({ hasProject: true }))).toBe(2)
  })

  it('all five → 5', () => {
    expect(
      countCompleted(
        partial({
          hasProject: true,
          hasBeatWithProse: true,
          hasTriedDirector: true,
          hasCompletedExport: true,
        }),
      ),
    ).toBe(5)
  })

  it('signedIn=false counts the others without it', () => {
    expect(countCompleted({ ...partial({ hasProject: true }), signedIn: false })).toBe(1)
  })
})

describe('allComplete', () => {
  it('false when any milestone missing', () => {
    expect(allComplete(partial({ hasProject: true, hasBeatWithProse: true }))).toBe(false)
  })

  it('true only when all 5 ticked', () => {
    expect(
      allComplete(
        partial({
          hasProject: true,
          hasBeatWithProse: true,
          hasTriedDirector: true,
          hasCompletedExport: true,
        }),
      ),
    ).toBe(true)
  })
})

describe('QUICK_START_ITEM_IDS', () => {
  it('contains exactly the 5 expected ids in spec order', () => {
    expect(QUICK_START_ITEM_IDS).toEqual([
      'signed_in',
      'has_project',
      'has_beat_with_prose',
      'has_tried_director',
      'has_completed_export',
    ])
  })
})
