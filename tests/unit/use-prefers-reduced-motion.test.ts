/**
 * Phase 8.11 unit — usePrefersReducedMotion hook contract.
 *
 * Verifies the SSR-safe default + the matchMedia integration. Uses
 * the renderToString convention (no DOM testing-library) plus a
 * lightweight matchMedia shim.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import React from 'react'

import { usePrefersReducedMotion } from '@/lib/hooks/usePrefersReducedMotion'

function Probe() {
  const reduced = usePrefersReducedMotion()
  return React.createElement('span', { 'data-reduced': String(reduced) })
}

describe('usePrefersReducedMotion', () => {
  beforeEach(() => {
    delete (globalThis as { window?: unknown }).window
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('returns false on SSR (no window)', () => {
    const html = renderToString(React.createElement(Probe))
    expect(html).toContain('data-reduced="false"')
  })

  it('returns false on the initial client render even when matchMedia matches', () => {
    // The hook starts with `false` and upgrades on first effect; the
    // server-rendered HTML therefore always says false. This test
    // pins that contract — hydration mismatches would happen if the
    // initial state differed from SSR.
    ;(globalThis as { window?: { matchMedia: (q: string) => unknown } }).window = {
      matchMedia: () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }),
    }
    const html = renderToString(React.createElement(Probe))
    expect(html).toContain('data-reduced="false"')
  })
})
