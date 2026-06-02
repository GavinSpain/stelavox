/**
 * FocusBreadcrumb opacity reducer — Phase 8.01.B T-7.
 *
 * Pure state-machine logic exported from FocusBreadcrumb for testability.
 * Spec contract per Component Spec v2.21 §6.2:
 *   - typing → 0 (only when NOT hovered and NOT touch-revealed)
 *   - at rest → 0.35
 *   - hover → 0.7 (beats typing and at-rest)
 *   - touch reveal → 0.7 (beats typing and at-rest)
 */

import { describe, expect, it } from 'vitest'

import { computeOpacity } from '@/components/focus/FocusBreadcrumb'

describe('computeOpacity (FocusBreadcrumb state machine)', () => {
  it('at rest (no typing, no hover, no touch reveal) → 0.35', () => {
    expect(computeOpacity({ isTyping: false, isHovered: false, isTouchRevealed: false })).toBe(0.35)
  })

  it('typing hides the breadcrumb → 0', () => {
    expect(computeOpacity({ isTyping: true, isHovered: false, isTouchRevealed: false })).toBe(0)
  })

  it('hover bumps to 0.7 even while at rest', () => {
    expect(computeOpacity({ isTyping: false, isHovered: true, isTouchRevealed: false })).toBe(0.7)
  })

  it('hover beats typing — author actively reaches for the breadcrumb', () => {
    expect(computeOpacity({ isTyping: true, isHovered: true, isTouchRevealed: false })).toBe(0.7)
  })

  it('touch reveal bumps to 0.7 (matches hover semantically)', () => {
    expect(computeOpacity({ isTyping: false, isHovered: false, isTouchRevealed: true })).toBe(0.7)
  })

  it('touch reveal beats typing too', () => {
    expect(computeOpacity({ isTyping: true, isHovered: false, isTouchRevealed: true })).toBe(0.7)
  })

  it('hover and touch reveal both true → 0.7 (no double-bump)', () => {
    expect(computeOpacity({ isTyping: false, isHovered: true, isTouchRevealed: true })).toBe(0.7)
  })
})
