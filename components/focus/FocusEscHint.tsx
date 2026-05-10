'use client'

// Spec: stelavox_component_specification_v2_1.md §6.3
// 🔒 Returns: NEVER. No hover behaviour after fade.

import { useEffect, useState } from 'react'

export function FocusEscHint() {
  const [opacity, setOpacity] = useState(0.3)

  useEffect(() => {
    const timer = setTimeout(() => setOpacity(0), 5000)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        right: '32px',
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
