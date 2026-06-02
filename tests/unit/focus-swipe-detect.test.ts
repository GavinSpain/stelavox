/**
 * Swipe-detect classifier — Phase 8.01.B T-7.
 *
 * Pure classification: takes pointer start + end coordinates and returns
 * the beat-nav direction. Spec contract per Component Spec v2.21 §18.3:
 *   - left swipe (deltaX < -60 in <350ms with <30px vertical drift) → 'next'
 *   - right swipe (deltaX > 60 ...) → 'prev'
 *   - short / slow / diagonal → 'none'
 *   - non-touch pointer (mouse / pen / unknown) → 'none'
 */

import { describe, expect, it } from 'vitest'

import {
  classifySwipe,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MAX_DURATION_MS,
  SWIPE_MAX_VERTICAL_DRIFT_PX,
} from '@/lib/focus/swipeDetect'

const TOUCH = 'touch'

describe('classifySwipe', () => {
  it('left swipe (deltaX < -60 in <350ms) → next', () => {
    expect(
      classifySwipe({
        startX: 400, startY: 200,
        endX: 200,   endY: 205,
        durationMs: 200,
        pointerType: TOUCH,
      }),
    ).toBe('next')
  })

  it('right swipe (deltaX > 60 in <350ms) → prev', () => {
    expect(
      classifySwipe({
        startX: 200, startY: 200,
        endX: 400,   endY: 195,
        durationMs: 200,
        pointerType: TOUCH,
      }),
    ).toBe('prev')
  })

  it('short swipe (40px distance) → none', () => {
    expect(
      classifySwipe({
        startX: 200, startY: 200,
        endX: 240,   endY: 200,
        durationMs: 200,
        pointerType: TOUCH,
      }),
    ).toBe('none')
  })

  it('slow swipe (500ms) → none', () => {
    expect(
      classifySwipe({
        startX: 400, startY: 200,
        endX: 200,   endY: 200,
        durationMs: 500,
        pointerType: TOUCH,
      }),
    ).toBe('none')
  })

  it('diagonal swipe (vertical drift > 30) → none', () => {
    expect(
      classifySwipe({
        startX: 400, startY: 200,
        endX: 200,   endY: 250, // 50px vertical drift
        durationMs: 200,
        pointerType: TOUCH,
      }),
    ).toBe('none')
  })

  it('mouse pointer → none (gated out)', () => {
    expect(
      classifySwipe({
        startX: 400, startY: 200,
        endX: 200,   endY: 200,
        durationMs: 200,
        pointerType: 'mouse',
      }),
    ).toBe('none')
  })

  it('pen pointer → none (gated out, only touch counts)', () => {
    expect(
      classifySwipe({
        startX: 400, startY: 200,
        endX: 200,   endY: 200,
        durationMs: 200,
        pointerType: 'pen',
      }),
    ).toBe('none')
  })

  it('thresholds are exported as named constants', () => {
    expect(SWIPE_MIN_DISTANCE_PX).toBe(60)
    expect(SWIPE_MAX_DURATION_MS).toBe(350)
    expect(SWIPE_MAX_VERTICAL_DRIFT_PX).toBe(30)
  })
})
