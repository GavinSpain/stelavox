'use client'

// Spec: stelavox_brand_identity_v2_0.md v2.2 §3.2 (construction), §3.3 (rule),
//       §3.4 (lozenge), §3.6 (colours), §3.7 (never).
//       Component Spec v2.21 §3.1.
//
// Inviolable #3 — Cinzel appears ONLY in this component (and AppIcon).
// Inviolable #6 — Cormorant Garamond italic appears ONLY in this component
//                  (added Phase 8.01 close-out after Dashboard iter4 silent
//                   regression).
// Inviolable #2 — verdigris uses #1 (lozenge) + #2 (rule).
//
// Implementation note per Brand Identity v2.2 §3.7: the lozenge is a square
// rotated 45°, NOT a primitive diamond glyph. The rotation + box-shadow glow
// are the brand-correct rendering.

import type { CSSProperties, MouseEventHandler } from 'react'

interface WordmarkProps {
  /** Display size variant. Default 'compact' (header use). */
  size?: 'compact' | 'hero'
  /** Render as an anchor link if true; otherwise a static div. */
  as?: 'div' | 'a'
  /** href when as='a'. Ignored otherwise. */
  href?: string
  /** Click handler; useful when wrapping in Next Link. */
  onClick?: MouseEventHandler<HTMLElement>
  /** Optional className for caller-side margin / positioning. */
  className?: string
  /** Accessibility label override. Defaults to "Stelavox". */
  ariaLabel?: string
}

interface SizeSpec {
  stelaFontSize: string
  voxFontSize: string
  voxWeight: 300 | 400
  ruleWidth: string
  ruleMarginTop: string
  lozengeSize: string
  lozengeLeft: string
  lozengeTop: string
  gap: string
}

const SIZES: Record<'compact' | 'hero', SizeSpec> = {
  compact: {
    stelaFontSize: '17px',
    voxFontSize: '19px',
    voxWeight: 400, // Phase 8.01 OQ-1: 400 at compact size (300 too light at 19px)
    ruleWidth: '100px',
    ruleMarginTop: '4px',
    lozengeSize: '9px',
    lozengeLeft: '-3px',
    lozengeTop: '-4px',
    gap: '0',
  },
  hero: {
    stelaFontSize: '42px',
    voxFontSize: '46px',
    voxWeight: 300, // Phase 8.01 OQ-1: 300 at hero size per Brand Identity §3.2
    ruleWidth: '240px',
    ruleMarginTop: '8px',
    lozengeSize: '13px',
    lozengeLeft: '-5px',
    lozengeTop: '-6px',
    gap: '0',
  },
}

const STELA_BASE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-cinzel), "Cinzel", "Trajan Pro", serif',
  fontWeight: 500,
  letterSpacing: '0.18em',
  color: 'var(--color-text-primary)',
  display: 'inline-block',
}

const VOX_BASE_STYLE: CSSProperties = {
  fontFamily: 'var(--font-cormorant), "Cormorant Garamond", Garamond, serif',
  fontStyle: 'italic',
  letterSpacing: '0.08em',
  color: 'var(--color-text-primary)',
  opacity: 0.88, // Brand Identity §3.2 / §3.6 calibrated relationship
  display: 'inline-block',
}

const RULE_BASE_STYLE: CSSProperties = {
  height: '1px',
  background:
    'linear-gradient(90deg, var(--color-accent) 0%, rgba(90,168,122,0.55) 45%, transparent 85%)',
}

const LOZENGE_BASE_STYLE: CSSProperties = {
  position: 'absolute',
  background: 'var(--color-accent)',
  transform: 'rotate(45deg)',
  boxShadow: '0 0 8px rgba(90,168,122,0.45)',
}

const LINK_RESET_STYLE: CSSProperties = {
  textDecoration: 'none',
  color: 'inherit',
  display: 'inline-block',
}

export function Wordmark({
  size = 'compact',
  as = 'div',
  href,
  onClick,
  className,
  ariaLabel = 'Stelavox',
}: WordmarkProps) {
  const spec = SIZES[size]

  const inner = (
    <>
      <span
        style={{ display: 'flex', alignItems: 'baseline' }}
        data-testid="wordmark-text"
      >
        <span style={{ ...STELA_BASE_STYLE, fontSize: spec.stelaFontSize }} data-testid="wordmark-stela">
          Stela
        </span>
        <span
          style={{ ...VOX_BASE_STYLE, fontSize: spec.voxFontSize, fontWeight: spec.voxWeight }}
          data-testid="wordmark-vox"
        >
          vox
        </span>
      </span>
      <span
        style={{ position: 'relative', display: 'block', marginTop: spec.ruleMarginTop }}
      >
        <span
          style={{ ...RULE_BASE_STYLE, width: spec.ruleWidth, display: 'block' }}
          data-testid="wordmark-rule"
        />
        <span
          style={{
            ...LOZENGE_BASE_STYLE,
            width: spec.lozengeSize,
            height: spec.lozengeSize,
            left: spec.lozengeLeft,
            top: spec.lozengeTop,
          }}
          data-testid="wordmark-lozenge"
        />
      </span>
    </>
  )

  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    lineHeight: 1,
    ...(as === 'a' ? LINK_RESET_STYLE : {}),
  }

  const commonProps = {
    'data-testid': 'wordmark',
    'data-size': size,
    className,
    style: containerStyle,
    'aria-label': ariaLabel,
  } as const

  if (as === 'a' && href) {
    return (
      <a href={href} onClick={onClick} {...commonProps}>
        {inner}
      </a>
    )
  }

  return (
    <div onClick={onClick} {...commonProps}>
      {inner}
    </div>
  )
}
