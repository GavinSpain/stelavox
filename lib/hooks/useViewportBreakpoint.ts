'use client'

// Phase 8.01.F T-1 — viewport-breakpoint hook.
//
// Spec: Component Spec v2.21 §18.2 (canonical responsive-breakpoint table).
// Hook returns one of four breakpoints matched by min-width media queries:
//   - desktop          ≥ 1280px
//   - tablet-landscape 1024–1279px
//   - tablet-portrait  768–1023px
//   - phone            < 768px (out of V1 scope; reported for completeness)
//
// SSR-safe: default returns 'desktop' so the first render is the desktop
// branch (this matches the most common case + avoids hydration mismatch).
// On mount, the actual breakpoint is detected and the hook re-renders if
// it differs. Each MediaQueryList only fires when the active breakpoint
// changes, NOT on every resize pixel — so no resize-event flood.

import { useEffect, useState } from 'react'

export type ViewportBreakpoint =
  | 'desktop'
  | 'tablet-landscape'
  | 'tablet-portrait'
  | 'phone'

// Exported as constants so unit tests + future tuning have a single source.
export const BREAKPOINT_DESKTOP_MIN = 1280
export const BREAKPOINT_TABLET_LANDSCAPE_MIN = 1024
export const BREAKPOINT_TABLET_PORTRAIT_MIN = 768

/**
 * Pure classification: given a viewport width in pixels, return the
 * matching breakpoint. Exported for unit testing.
 */
export function classifyViewport(widthPx: number): ViewportBreakpoint {
  if (widthPx >= BREAKPOINT_DESKTOP_MIN) return 'desktop'
  if (widthPx >= BREAKPOINT_TABLET_LANDSCAPE_MIN) return 'tablet-landscape'
  if (widthPx >= BREAKPOINT_TABLET_PORTRAIT_MIN) return 'tablet-portrait'
  return 'phone'
}

export function useViewportBreakpoint(): ViewportBreakpoint {
  const [bp, setBp] = useState<ViewportBreakpoint>('desktop')

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    function classify(): ViewportBreakpoint {
      return classifyViewport(window.innerWidth)
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBp(classify())

    const queries: MediaQueryList[] = [
      window.matchMedia(`(min-width: ${BREAKPOINT_DESKTOP_MIN}px)`),
      window.matchMedia(`(min-width: ${BREAKPOINT_TABLET_LANDSCAPE_MIN}px)`),
      window.matchMedia(`(min-width: ${BREAKPOINT_TABLET_PORTRAIT_MIN}px)`),
    ]
    function onChange() {
      setBp(classify())
    }
    for (const q of queries) {
      q.addEventListener('change', onChange)
    }
    return () => {
      for (const q of queries) {
        q.removeEventListener('change', onChange)
      }
    }
  }, [])

  return bp
}
