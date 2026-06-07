'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §6.3.
//       stelavox_phase8_01_B_build_checklist_v1_0.md T-4.
//       Phase 8.8 amendment 2026-06-07 — see "discoverability fix" below.
//
// Phase 8.01.B T-4:
//   - Position moves from bottom-right to bottom-left (WordCount per §5.7
//     owns bottom-right; the two hints can't share the corner).
//   - Touch variant renders a 44×44 "← Edit" pill with persistent 0.4
//     opacity (tap is the only Focus Mode exit on touch — the affordance
//     can't fade out of existence) and an onClick that calls onExit.
//
// Phase 8.8 discoverability fix (2026-06-07):
//   - Desktop variant previously read "fades to 0 after 5s, never
//     returns." Real-user feedback showed first-time users hit Focus
//     Mode, missed the 5-second window, and could not find their way
//     out. The hint now mirrors WordCount's opacity machine — it
//     fades out while the author is typing and re-appears when the
//     editor is idle. Same trigger as WordCount (§5.7): isTyping
//     latches on keydown and clears 300ms later; recentlyTyped
//     clears another 3000ms after that. While either is true the hint
//     hides; otherwise it sits at 0.3 opacity.
//   - The "kbd users don't need a reminder mid-write" spec rationale
//     still holds — the hint disappears WHILE WRITING. It just doesn't
//     stay gone forever.
//
// 🔒 Touch variant unchanged — tap is still the only exit on touch.

import { useEffect, useState } from 'react'

interface FocusEscHintProps {
  /** Called when the user taps the touch pill (no-op on desktop). */
  onExit?: () => void
}

/** Find the ProseMirror DOM element inside the Focus Mode editor. The
 *  editor sits inside the FocusMode portal; we query at document level
 *  rather than threading the editor ref through props. */
function findProseEl(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector(
    '[data-editor="prose"][data-mode="focus"] .ProseMirror',
  ) as HTMLElement | null
}

export function FocusEscHint({ onExit }: FocusEscHintProps = {}) {
  const [isTouchPrimary, setIsTouchPrimary] = useState(false)
  // Phase 8.8 — mirror WordCount's opacity state machine.
  const [isTyping, setIsTyping] = useState(false)
  const [recentlyTyped, setRecentlyTyped] = useState(false)

  // Detect coarse pointer (iPad / touch) on mount. SSR-safe default false
  // so first render is the desktop branch; hydration upgrades if needed.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouchPrimary(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Desktop only: listen to keydown on the prose editor's DOM, same
  // pattern as WordCount (§5.7). 300ms typing window, 3s recently-typed
  // window. While either is true the hint hides; otherwise it shows.
  // Touch variant skips this — its opacity is locked at 0.4.
  useEffect(() => {
    if (isTouchPrimary) return

    let typingTimer: ReturnType<typeof setTimeout> | null = null
    let idleTimer: ReturnType<typeof setTimeout> | null = null
    let proseEl: HTMLElement | null = null
    let mountRetry: ReturnType<typeof setTimeout> | null = null

    function onKeydown() {
      setIsTyping(true)
      setRecentlyTyped(true)
      if (typingTimer) clearTimeout(typingTimer)
      if (idleTimer) clearTimeout(idleTimer)
      typingTimer = setTimeout(() => {
        setIsTyping(false)
        idleTimer = setTimeout(() => setRecentlyTyped(false), 3000)
      }, 300)
    }

    function attach() {
      proseEl = findProseEl()
      if (!proseEl) {
        // Editor isn't in the DOM yet — retry shortly. The FocusMode
        // overlay portal mounts the editor on a subsequent commit; one
        // short retry covers the race.
        mountRetry = setTimeout(attach, 80)
        return
      }
      proseEl.addEventListener('keydown', onKeydown)
    }
    attach()

    return () => {
      if (mountRetry) clearTimeout(mountRetry)
      if (typingTimer) clearTimeout(typingTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (proseEl) proseEl.removeEventListener('keydown', onKeydown)
    }
  }, [isTouchPrimary])

  // Desktop opacity per the WordCount-mirrored state machine. Touch
  // opacity is its own constant.
  //
  // Phase 8.8 follow-up — bumped from 0.3 to 1.0 when visible. At 0.3
  // on top of --color-text-muted the hint failed any reasonable
  // readability check (same WCAG concern that drove WordCount's
  // 0.4 → 1.0 idle bump in the a11y sweep). The text colour stays
  // muted so the hint doesn't compete with the prose surface; full
  // opacity makes it legible at the corner of vision.
  const opacity = isTouchPrimary
    ? 0.4
    : isTyping || recentlyTyped
      ? 0
      : 1

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
