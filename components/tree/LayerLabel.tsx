'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §18.1 (Phase 8.01 lock).
//
// Universal bracketed monospace layer label, used everywhere the app shows a
// hierarchical position: NodeRow (§4.2), FocusBreadcrumb (§6.2), detail-pane
// crumb (§5.2 — landing in 8.01.E), dashboard hero crumb (8.01.D), Director
// `@` mention picker (8.01.C), Project Page export tree-with-checkboxes
// (8.01.E).
//
// Phase 14 note. The hardcoded abbreviation map below is the spec-acknowledged
// stub. Phase 14 (post-V1) extends `layer_stacks.layers[i]` with abbreviation,
// singular_label, plural_label, at_reference_token fields, and replaces this
// map with a layer_stack-driven lookup. The component contract stays the same
// so Phase 14 can swap the data source without breaking callers — keep the
// LayerLabelProps shape conservative.
//
// Inviolable #2: no --color-accent here. The label borders use the neutral
// default border token.

import type { CSSProperties } from 'react'

export type LayerKind = 'series' | 'book' | 'act' | 'chapter' | 'scene' | 'beat'

/**
 * Spec-acknowledged stub. Phase 14 replaces this map with a per-document
 * layer_stack-driven lookup. Exported for unit tests + future Phase 14
 * compatibility shims.
 */
export const LAYER_ABBR: Record<LayerKind, string> = {
  series: 'Series',
  book: 'Book',
  act: 'Act',
  chapter: 'Ch',
  scene: 'Sc',
  beat: 'Bt',
}

interface LayerLabelProps {
  /** Layer type — drives the abbreviation. */
  layer: LayerKind
  /**
   * 1-based position number, sourced from nodes.order. Omitted from the
   * rendered output for `series` (there is exactly one Series node per
   * series-stack document; numbering would be visual noise).
   */
  position?: number
  /** Optional className for caller-side margin / positioning. */
  className?: string
  /** Optional style override (merged on top of the spec styles). */
  style?: CSSProperties
}

const SPEC_STYLE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, monospace',
  fontSize: '10.5px',
  letterSpacing: '0.02em',
  padding: '1px 5px',
  border: '1px solid var(--color-border-default)',
  borderRadius: '3px',
  color: 'var(--color-text-primary)',
  background: 'transparent',
  lineHeight: 1.4,
  whiteSpace: 'nowrap',
}

export function LayerLabel({ layer, position, className, style }: LayerLabelProps) {
  const abbr = LAYER_ABBR[layer] ?? toTitleCase(String(layer))
  // Series: omit the number per spec (exactly one Series node per series-stack
  // document). Every other layer renders the position.
  const showPosition = layer !== 'series' && typeof position === 'number'
  const body = showPosition ? `[${abbr} ${position}]` : `[${abbr}]`

  return (
    <span
      data-testid="layer-label"
      data-layer={layer}
      data-position={position ?? ''}
      className={className}
      style={{ ...SPEC_STYLE, ...style }}
    >
      {body}
    </span>
  )
}

/**
 * Defensive fallback for an unknown layer type. Phase 14 won't need this
 * (the abbreviation comes from the data) but for V1 we want a non-empty
 * render rather than a missing label.
 */
function toTitleCase(s: string): string {
  if (s.length === 0) return s
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}
