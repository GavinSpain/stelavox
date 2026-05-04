'use client'

// Spec: stelavox_component_specification_v2_1.md §6.2
// 🔒 Inviolable: pointer-events: none ALWAYS. Maximum opacity 0.2 — never higher.
// ♿ aria-hidden="true" — decorative location text, not navigation.

import { useEffect, useState } from 'react'

interface FocusBreadcrumbProps {
  segments: string[]
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
      {segments.map((seg, i) => (
        <span key={i}>
          {seg}
          {i < segments.length - 1 && (
            <span style={{ opacity: 0.4, margin: '0 8px' }}>·</span>
          )}
        </span>
      ))}
    </div>
  )
}
