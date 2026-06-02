// Phase 8.01.F T-10 — viewport breakpoint classifier.

import { describe, expect, it } from 'vitest'

import {
  classifyViewport,
  BREAKPOINT_DESKTOP_MIN,
  BREAKPOINT_TABLET_LANDSCAPE_MIN,
  BREAKPOINT_TABLET_PORTRAIT_MIN,
} from '@/lib/hooks/useViewportBreakpoint'

describe('classifyViewport', () => {
  it('1400px → desktop', () => {
    expect(classifyViewport(1400)).toBe('desktop')
  })

  it('1280px (boundary) → desktop', () => {
    expect(classifyViewport(1280)).toBe('desktop')
  })

  it('1279px → tablet-landscape', () => {
    expect(classifyViewport(1279)).toBe('tablet-landscape')
  })

  it('1100px → tablet-landscape', () => {
    expect(classifyViewport(1100)).toBe('tablet-landscape')
  })

  it('1024px (boundary) → tablet-landscape', () => {
    expect(classifyViewport(1024)).toBe('tablet-landscape')
  })

  it('900px → tablet-portrait', () => {
    expect(classifyViewport(900)).toBe('tablet-portrait')
  })

  it('768px (boundary) → tablet-portrait', () => {
    expect(classifyViewport(768)).toBe('tablet-portrait')
  })

  it('600px → phone', () => {
    expect(classifyViewport(600)).toBe('phone')
  })

  it('exposes the boundary constants', () => {
    expect(BREAKPOINT_DESKTOP_MIN).toBe(1280)
    expect(BREAKPOINT_TABLET_LANDSCAPE_MIN).toBe(1024)
    expect(BREAKPOINT_TABLET_PORTRAIT_MIN).toBe(768)
  })
})
