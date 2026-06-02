// Phase 8.01.F T-10 — long-press classifier.

import { describe, expect, it } from 'vitest'

import {
  classifyLongPress,
  LONG_PRESS_DRAG_MS,
  LONG_PRESS_CONTEXT_MENU_MS,
  LONG_PRESS_MOVE_THRESHOLD_PX,
} from '@/lib/touch/useLongPress'

describe('classifyLongPress', () => {
  it('quick tap (< 350ms, touch) → tap', () => {
    expect(classifyLongPress({ durationMs: 200, movedPx: 0, pointerType: 'touch' })).toBe('tap')
  })

  it('350ms hold, touch → drag', () => {
    expect(classifyLongPress({ durationMs: 400, movedPx: 0, pointerType: 'touch' })).toBe('drag')
  })

  it('800ms hold, touch → context', () => {
    expect(classifyLongPress({ durationMs: 900, movedPx: 0, pointerType: 'touch' })).toBe('context')
  })

  it('exactly 350ms boundary → drag', () => {
    expect(classifyLongPress({ durationMs: LONG_PRESS_DRAG_MS, movedPx: 0, pointerType: 'touch' })).toBe('drag')
  })

  it('exactly 800ms boundary → context', () => {
    expect(classifyLongPress({ durationMs: LONG_PRESS_CONTEXT_MENU_MS, movedPx: 0, pointerType: 'touch' })).toBe('context')
  })

  it('movement > threshold → cancel even with long duration', () => {
    expect(classifyLongPress({ durationMs: 900, movedPx: 20, pointerType: 'touch' })).toBe('cancel')
  })

  it('mouse pointer → cancel regardless of duration', () => {
    expect(classifyLongPress({ durationMs: 900, movedPx: 0, pointerType: 'mouse' })).toBe('cancel')
  })

  it('pen pointer → cancel regardless of duration', () => {
    expect(classifyLongPress({ durationMs: 900, movedPx: 0, pointerType: 'pen' })).toBe('cancel')
  })

  it('exposes the threshold constants', () => {
    expect(LONG_PRESS_DRAG_MS).toBe(350)
    expect(LONG_PRESS_CONTEXT_MENU_MS).toBe(800)
    expect(LONG_PRESS_MOVE_THRESHOLD_PX).toBe(8)
  })
})
