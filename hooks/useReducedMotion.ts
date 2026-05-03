import { useEffect, useState } from 'react'

// Single source of truth for `prefers-reduced-motion`. Every transition in
// §3.6 reads from this hook so the value never drifts (T-6.2 risk register).
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Hydrate from the matchMedia query result on first mount — same SSR-safe
    // pattern as AppShell.tsx's localStorage hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReduced(mql.matches)
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return reduced
}
