'use client'

// Phase 8.01 wireframe-alignment round 2 — Director-persona brand mark.
//
// Spec: docs/wireframes/wireframe_phase8_01_ux_consistency/05_director_mode_v1_iter1.html
//       .dp-mark — 32×32 rounded square, verdigris gradient background,
//       Cinzel glyph inside, soft verdigris glow.
//
// Inviolable #3 v2.4 refinement: this component is the sanctioned
// site for Cinzel outside the wordmark. The DirectorPanel header
// imports the mark + label from here; no other module should use
// Cinzel.
//
// Inviolable #2: the gradient mark is brand-mark family (use #1
// precedent — analogous to the wordmark lozenge as a brand-identity
// element). It is not a new verdigris use category.

interface DirectorMarkProps {
  /** Size in px. Defaults to 32 per wireframe. */
  size?: number
}

export function DirectorMark({ size = 32 }: DirectorMarkProps) {
  return (
    <span
      data-testid="director-mark"
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        background:
          'linear-gradient(135deg, var(--color-accent) 0%, var(--color-accent-hover) 100%)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'Cinzel, serif',
        fontSize: Math.round(size * 0.5),
        fontWeight: 600,
        color: '#0d1014',
        letterSpacing: '0.04em',
        boxShadow: '0 0 14px rgba(90,168,122,0.25)',
        flexShrink: 0,
      }}
    >
      S
    </span>
  )
}

/** "Director" label set in Cinzel — paired with DirectorMark in the
 *  panel header. Same admitted-use-site rationale (Inviolable #3 v2.4). */
export function DirectorLabel() {
  return (
    <span
      data-testid="director-label"
      style={{
        fontFamily: 'Cinzel, serif',
        fontSize: 13,
        fontWeight: 500,
        color: 'var(--color-text-primary)',
        letterSpacing: '0.05em',
      }}
    >
      Director
    </span>
  )
}
