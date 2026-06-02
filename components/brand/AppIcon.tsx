'use client'

// Spec: stelavox_brand_identity_v2_0.md v2.2 §3.5 (The App Icon).
//       Component Spec v2.21 §10.1.
//
// Inviolable #3 — Cinzel appears ONLY in Wordmark + here (the S is the
//                  wordmark in icon form).
// Inviolable #2 — verdigris lozenge at the base of the S, use #1 (brand).
//
// The icon never uses the full wordmark in an icon-sized space. The S alone
// is the mark. Default 32px; supports 24px (lozenge becomes a colour point
// rather than a shape at small sizes — acceptable per spec).

import type { CSSProperties } from 'react'

interface AppIconProps {
  /** Square edge length in pixels. Default 32. */
  size?: number
  /** Optional className for caller-side margin / positioning. */
  className?: string
}

const CONTAINER_BASE_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
  borderRadius: '6px',
  background:
    'radial-gradient(circle at center, #1a2535 0%, #0a0e14 100%)',
  overflow: 'hidden',
  flexShrink: 0,
}

const S_BASE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-cinzel), "Cinzel", "Trajan Pro", serif',
  fontWeight: 600,
  color: 'var(--color-text-primary)',
  letterSpacing: 0,
  lineHeight: 1,
  display: 'block',
}

const LOZENGE_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  background: 'var(--color-accent)',
  transform: 'rotate(45deg)',
}

export function AppIcon({ size = 32, className }: AppIconProps) {
  const sStyle: CSSProperties = {
    ...S_BASE_STYLE,
    fontSize: `${Math.round(size * 0.72)}px`, // S occupies ~72% of icon height
  }
  const lozengeSize = Math.max(2, Math.round(size * 0.09))
  const lozengeStyle: CSSProperties = {
    ...LOZENGE_BASE_STYLE,
    width: `${lozengeSize}px`,
    height: `${lozengeSize}px`,
    bottom: `${Math.round(size * 0.12)}px`,
    left: '50%',
    marginLeft: `${-lozengeSize / 2}px`,
  }
  return (
    <span
      data-testid="app-icon"
      data-size={size}
      className={className}
      style={{ ...CONTAINER_BASE_STYLE, width: size, height: size }}
      aria-label="Stelavox"
    >
      <span style={sStyle}>S</span>
      <span data-testid="app-icon-lozenge" style={lozengeStyle} />
    </span>
  )
}
