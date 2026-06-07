'use client'

/**
 * Phase 8.11 — system motion-preference detector.
 *
 * Reads the `prefers-reduced-motion: reduce` media query and returns
 * true when the user has expressed a preference for less motion (OS
 * setting). Re-renders on preference changes so consumers can swap
 * out transitions / animations live.
 *
 * Used by:
 *   - components/detail/WordCount.tsx — collapses the 800ms fade
 *   - components/focus/SentenceFocus.tsx (via CSS @media query) —
 *     collapses the 200ms opacity transition
 *
 * SSR-safe: returns false on the server (no matchMedia available);
 * hydration picks up the real preference on first effect.
 */

import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function usePrefersReducedMotion(): boolean {
  // SSR-safe default: server renders as "no preference" so transitions
  // are present in the initial HTML; the client effect upgrades.
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(QUERY)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mq.matches)
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    // addEventListener is the modern API; addListener is the deprecated
    // fallback for Safari < 14. Probe and use whichever exists.
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const legacy = mq as any
    if (typeof legacy.addListener === 'function') {
      legacy.addListener(handler)
      return () => legacy.removeListener(handler)
    }
    return undefined
  }, [])

  return reduced
}
