'use client'

// Spec: stelavox_component_specification_v2_1.md §5.8 (FocusModeButton)

import { useState } from 'react'

interface FocusModeButtonProps {
  onClick: () => void
}

export function FocusModeButton({ onClick }: FocusModeButtonProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '5px 10px',
        background: 'transparent',
        border: `1px solid ${hovered ? 'var(--color-border-default)' : 'var(--color-border-subtle)'}`,
        borderRadius: '4px',
        fontSize: '11px',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontWeight: 400,
        color: hovered ? 'var(--color-text-secondary)' : 'var(--color-text-muted)',
        cursor: 'pointer',
        transition: 'color var(--duration-fast), border-color var(--duration-fast)',
      }}
    >
      ⊞ Focus Mode
      <span style={{ opacity: 0.5 }}>⌘↵</span>
    </button>
  )
}
