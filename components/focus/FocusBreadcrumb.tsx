'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §6.2.
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-6 (structured shape).
//       stelavox_phase8_01_B_build_checklist_v1_0.md T-3 (opacity bump +
//                                                          hover/touch reveal).
//
// Phase 8.01.B T-3: opacity ceiling moves from 0.2 to 0.35 at rest /
// 0.7 on hover or touch reveal. The position counter ("2 / 5") and the
// leaf node name appear ONLY at 0.7 (the hover/touch reveal). Legacy
// `string[]` segments fallback path removed (8.01.A's FocusMode caller
// is now migrated; no other caller exists).
//
// 🔒 pointer-events: none on the inner content ALWAYS. The breadcrumb is
//    read-only orientation, never navigation. The hover-bump uses an
//    outer wrapper with pointer-events: auto to receive mouse enter/leave
//    + touch events; the inner content (LayerLabel chain) stays
//    non-interactive so clicks pass through to whatever's behind.
// ♿ aria-hidden="true" — decorative location text, not navigation.

import { useEffect, useState } from 'react'
import { LayerLabel, type LayerKind } from '@/components/tree/LayerLabel'

export interface FocusBreadcrumbSegment {
  layer: LayerKind
  position: number
  /** Leaf node name — rendered only on hover/touch reveal (opacity 0.7). */
  name?: string
}

interface FocusBreadcrumbProps {
  segments: FocusBreadcrumbSegment[]
  /**
   * Optional position counter ("N / M") rendered only on hover/touch
   * reveal. `index` is 1-based for display per Phase 8.01.B OQ-1 lock.
   */
  position?: { index: number; total: number }
}

// Phase 8.01.B T-3 state machine (extracted for unit testing per T-7).
export interface OpacityInputs {
  isTyping: boolean
  isHovered: boolean
  isTouchRevealed: boolean
}

/**
 * Pure opacity reducer per Component Spec v2.21 §6.2 revised table.
 * Hover/touch reveal beats typing (the user is actively reaching for
 * the breadcrumb). Typing while not hovering hides the breadcrumb.
 * Otherwise the at-rest 0.35 ceiling applies.
 */
export function computeOpacity({
  isTyping,
  isHovered,
  isTouchRevealed,
}: OpacityInputs): number {
  if (isHovered || isTouchRevealed) return 0.7
  if (isTyping) return 0
  return 0.35
}

const TYPING_HIDE_MS = 3000
const TOUCH_REVEAL_MS = 4000 // Phase 8.01.B OQ-2 lock

export function FocusBreadcrumb({ segments, position }: FocusBreadcrumbProps) {
  const [isTyping, setIsTyping] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const [isTouchRevealed, setIsTouchRevealed] = useState(false)
  const [isTouchPrimary, setIsTouchPrimary] = useState(false)

  // Detect coarse pointer (iPad / touch) on mount. Defaults to false on
  // SSR so the first render is the desktop branch — hydration upgrade.
  // Single mount-time setState (matches the FocusMode portal-target pattern
  // at line 200 of FocusMode.tsx) — does NOT cascade renders.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsTouchPrimary(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  // Typing detection — the existing 3s-idle behaviour from v2.20.
  useEffect(() => {
    let typingTimer: ReturnType<typeof setTimeout> | null = null
    function onKeydown() {
      setIsTyping(true)
      if (typingTimer) clearTimeout(typingTimer)
      typingTimer = setTimeout(() => setIsTyping(false), TYPING_HIDE_MS)
    }
    window.addEventListener('keydown', onKeydown)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      if (typingTimer) clearTimeout(typingTimer)
    }
  }, [])

  const opacity = computeOpacity({ isTyping, isHovered, isTouchRevealed })
  const isRevealed = opacity === 0.7

  // Touch tap reveal — 4s timer per OQ-2. Desktop pointers route through
  // the hover path; coarse-pointer devices use this handler.
  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!isTouchPrimary) return
    if (e.pointerType !== 'touch') return
    setIsTouchRevealed(true)
    window.setTimeout(() => setIsTouchRevealed(false), TOUCH_REVEAL_MS)
  }

  // Last segment is the leaf — extract for the name reveal.
  const leaf = segments.length > 0 ? segments[segments.length - 1] : null
  const leafName = leaf?.name

  return (
    <div
      data-testid="focus-breadcrumb"
      data-opacity-state={
        isRevealed ? 'revealed' : isTyping ? 'typing' : 'at-rest'
      }
      aria-hidden="true"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onPointerDown={onPointerDown}
      style={{
        position: 'absolute',
        top: '20px',
        left: 0,
        right: 0,
        textAlign: 'center',
        color: 'var(--color-text-primary)',
        // Outer wrapper receives pointer events so hover + touch register;
        // inner content (the LayerLabel chain) is non-interactive so clicks
        // pass through. This keeps the Inviolable "breadcrumb is never
        // navigation" guarantee while allowing the hover/touch bump.
        pointerEvents: 'auto',
        opacity,
        transition:
          isRevealed
            ? 'opacity 200ms var(--easing-default, cubic-bezier(0.25,0.1,0.25,1))'
            : 'opacity 800ms var(--easing-prose, cubic-bezier(0.16,1,0.3,1))',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'none', // inner content stays non-interactive
        }}
      >
        {segments.map((seg, i, arr) => (
          <span
            key={i}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <LayerLabel layer={seg.layer} position={seg.position} />
            {i < arr.length - 1 && (
              <span
                style={{
                  color: 'var(--color-text-faint)',
                  fontFamily: 'var(--font-inter), Inter, sans-serif',
                  fontSize: '11px',
                }}
              >
                ·
              </span>
            )}
          </span>
        ))}

        {/* Position counter "N / M" — appears only on hover/touch reveal. */}
        {isRevealed && position && (
          <span
            data-testid="focus-breadcrumb-position"
            style={{
              marginLeft: '6px',
              fontFamily:
                'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
              fontSize: '9.5px',
              color: 'var(--color-text-faint)',
              letterSpacing: '0.02em',
            }}
          >
            {position.index} / {position.total}
          </span>
        )}

        {/* Leaf node name — appears only on hover/touch reveal. */}
        {isRevealed && leafName && (
          <span
            data-testid="focus-breadcrumb-leaf-name"
            style={{
              marginLeft: '8px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: '11px',
              color: 'var(--color-text-primary)',
            }}
          >
            — {leafName}
          </span>
        )}
      </span>
    </div>
  )
}
