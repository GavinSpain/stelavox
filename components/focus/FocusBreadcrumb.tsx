'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §6.2.
//       stelavox_phase8_01_A_build_checklist_v1_0.md T-6.
//
// Phase 8.01.A T-6: prop shape moves from `segments: string[]` to a richer
// structured form carrying layer kind + position, so each segment renders
// through the universal <LayerLabel> (§18.1). The opacity ceiling stays at
// 0.2 in 8.01.A — the 0.35-steady / 0.7-hover ceiling bump from the v2.21
// spec lands in 8.01.B alongside the rest of the Focus Mode polish
// (FocusEscHint move, "← Edit" pill, position counter "2 / 5" reveal).
//
// 🔒 pointer-events: none ALWAYS. The breadcrumb is read-only orientation,
//    never navigation. (Detail-pane crumb in 8.01.E is the tappable one.)
// ♿ aria-hidden="true" — decorative location text, not navigation.
//
// Backward-compat: if a caller still passes `string[]`, the component
// renders the strings as plain text with a dev-only deprecation log.
// The fallback can be removed in 8.01.B once FocusMode is migrated.

import { useEffect, useState } from 'react'
import { LayerLabel, type LayerKind } from '@/components/tree/LayerLabel'

export interface FocusBreadcrumbSegment {
  layer: LayerKind
  position: number
  /** Leaf node name — rendered only on hover/touch reveal (8.01.B). */
  name?: string
}

interface FocusBreadcrumbProps {
  segments: FocusBreadcrumbSegment[] | string[]
}

function isLegacyStringSegments(segments: unknown[]): segments is string[] {
  return segments.length > 0 && typeof segments[0] === 'string'
}

export function FocusBreadcrumb({ segments }: FocusBreadcrumbProps) {
  const [opacity, setOpacity] = useState(0.2)
  const [isTyping, setIsTyping] = useState(false)

  useEffect(() => {
    let typingTimer: ReturnType<typeof setTimeout> | null = null

    function onKeydown() {
      setIsTyping(true)
      setOpacity(0)
      if (typingTimer) clearTimeout(typingTimer)
      typingTimer = setTimeout(() => {
        setIsTyping(false)
        setOpacity(0.2)
      }, 3000)
    }

    function onMouseMove() {
      if (isTyping) return
      setOpacity(0.2)
    }

    window.addEventListener('keydown', onKeydown)
    window.addEventListener('mousemove', onMouseMove)
    return () => {
      window.removeEventListener('keydown', onKeydown)
      window.removeEventListener('mousemove', onMouseMove)
      if (typingTimer) clearTimeout(typingTimer)
    }
  }, [isTyping])

  // Backward-compat: render plain strings if caller hasn't migrated yet.
  if (isLegacyStringSegments(segments)) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[FocusBreadcrumb] string[] segments are deprecated as of Phase 8.01.A. ' +
          'Switch to FocusBreadcrumbSegment[] ({ layer, position, name? }).',
      )
    }
    return (
      <div
        data-testid="focus-breadcrumb"
        data-fallback="legacy-string"
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '20px',
          left: 0,
          right: 0,
          textAlign: 'center',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 200,
          fontSize: '11px',
          letterSpacing: '0.04em',
          color: 'var(--color-text-muted)',
          pointerEvents: 'none',
          opacity,
          transition: 'opacity 800ms var(--easing-prose, cubic-bezier(0.16, 1, 0.3, 1))',
        }}
      >
        {(segments as string[]).map((seg, i, arr) => (
          <span key={i}>
            {seg}
            {i < arr.length - 1 && (
              <span style={{ opacity: 0.4, margin: '0 8px' }}>·</span>
            )}
          </span>
        ))}
      </div>
    )
  }

  // New shape: structured segments rendered as LayerLabel pills.
  const structured = segments as FocusBreadcrumbSegment[]

  return (
    <div
      data-testid="focus-breadcrumb"
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '20px',
        left: 0,
        right: 0,
        textAlign: 'center',
        // The LayerLabel pills have their own typography; container only
        // provides the separator + opacity envelope.
        color: 'var(--color-text-primary)',
        pointerEvents: 'none',
        opacity,
        transition: 'opacity 800ms var(--easing-prose, cubic-bezier(0.16, 1, 0.3, 1))',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        {structured.map((seg, i, arr) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
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
      </span>
    </div>
  )
}
