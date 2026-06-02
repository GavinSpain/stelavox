'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §6.3.
//       stelavox_phase8_01_B_build_checklist_v1_0.md T-4.
//
// Phase 8.01.B T-4:
//   - Position moves from bottom-right to bottom-left (WordCount per §5.7
//     owns bottom-right; the two hints can't share the corner).
//   - Touch variant renders a 44×44 "← Edit" pill with persistent 0.4
//     opacity (tap is the only Focus Mode exit on touch — the affordance
//     can't fade out of existence) and an onClick that calls onExit.
//   - Desktop variant unchanged from v2.20: "Esc to exit" Inter 10px,
//     fades out after 5s, never returns (kbd users don't need a reminder
//     mid-write).
//
// 🔒 Desktop "returns: NEVER. No hover behaviour after fade." holds. The
//    touch pill is the OPPOSITE — it must persist because tap is the only
//    exit. These are different surfaces serving different input models;
//    the §6.3 spec extends to cover both per the Phase 8.01 wireframe lock.

import { useEffect, useState } from 'react'

interface FocusEscHintProps {
  /** Called when the user taps the touch pill (no-op on desktop). */
  onExit?: () => void
}

export function FocusEscHint({ onExit }: FocusEscHintProps = {}) {
  const [opacity, setOpacity] = useState(0.3)
  const [isTouchPrimary, setIsTouchPrimary] = useState(false)

  // Detect coarse pointer (iPad / touch) on mount. SSR-safe default false
  // so first render is the desktop branch; hydration upgrades if needed.
  // Single mount-time setState — does NOT cascade renders.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouchPrimary(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Desktop only: fade after 5s. Touch keeps the pill visible permanently.
  // The setState here is keyed on isTouchPrimary (a stable post-hydration
  // value), not on render output — no cascade risk.
  useEffect(() => {
    if (isTouchPrimary) {
      // Touch: lock opacity at 0.4 permanently; tap is the only exit.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpacity(0.4)
      return
    }
    const timer = setTimeout(() => setOpacity(0), 5000)
    return () => clearTimeout(timer)
  }, [isTouchPrimary])

  if (isTouchPrimary) {
    // Touch variant: 44×44 tap pill with "← Edit" copy.
    return (
      <button
        type="button"
        data-testid="focus-esc-hint"
        data-variant="touch"
        onClick={() => onExit?.()}
        style={{
          position: 'fixed',
          bottom: '20px',
          left: '24px',
          minWidth: '44px',
          minHeight: '44px',
          padding: '8px 14px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 400,
          fontSize: '12px',
          letterSpacing: '0.02em',
          color: 'var(--color-text-primary)',
          background: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '6px',
          cursor: 'pointer',
          opacity,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          // Reduce-motion users still get the fade out.
          transition: 'opacity 200ms ease-out',
        }}
      >
        ← Edit
      </button>
    )
  }

  // Desktop variant: kbd-style hint, bottom-LEFT (moved from bottom-right
  // in 8.01.B because WordCount now owns bottom-right per §5.7).
  return (
    <div
      data-testid="focus-esc-hint"
      data-variant="desktop"
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '32px',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 300,
        fontSize: '10px',
        letterSpacing: '0.12em',
        color: 'var(--color-text-muted)',
        opacity,
        pointerEvents: 'none',
        // --duration-slow per spec; falls back to 1200ms
        transition: 'opacity var(--duration-slow, 1200ms) ease-out',
      }}
    >
      Esc to exit
    </div>
  )
}
