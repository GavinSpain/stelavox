// Phase 8.01 wireframe-alignment round 3 — Tree layer column header.
//
// Spec: docs/wireframes/wireframe_phase8_01_ux_consistency/02_edit_mode_v2_iter3.html
//       .tree-layer-hdr — one-row strip above the tree showing
//       `[Book] [Act] [Ch] [Sc] [Bt]` in monospace, layer-tinted, at
//       indent column positions matching the tree's `.in-N` padding.
//
// The strip functions as a "compass" — reading down a column tells the
// author what depth a row is at. Cheap visual chrome, no data binding.
//
// Per-layer colour tints come from `02_edit_mode_v2_iter3.html`:
//   --layer-book    #5aa87a (verdigris-bright)
//   --layer-act     #7a8fb8
//   --layer-chapter #8a99b3
//   --layer-scene   #7a8a9e
//   --layer-beat    #6884a4 (= --color-text-muted)
//
// Inviolable #2: the `[Book]` cell renders at the same #5aa87a as
// --color-accent-hover. This re-uses the brand-mark family (use #1
// precedent — layer-Book is the highest-level structural anchor, the
// same way the wordmark lozenge anchors the brand). No new sanctioned
// use category.

const LAYER_CELLS: ReadonlyArray<{
  label: string
  color: string
  marginLeft: number
}> = [
  { label: '[Book]',    color: 'var(--color-accent-hover)', marginLeft: 0 },
  { label: '[Act]',     color: '#7a8fb8',                   marginLeft: 22 },
  { label: '[Ch]',      color: '#8a99b3',                   marginLeft: 22 },
  { label: '[Sc]',      color: '#7a8a9e',                   marginLeft: 22 },
  { label: '[Bt]',      color: 'var(--color-text-muted)',   marginLeft: 22 },
]

export function TreeLayerHeader() {
  return (
    <div
      data-testid="tree-layer-header"
      aria-hidden
      style={{
        display: 'flex',
        padding: '10px 20px 8px',
        borderBottom: '1px solid var(--color-border-subtle)',
        background:
          'linear-gradient(180deg, color-mix(in srgb, var(--color-bg-surface) 70%, transparent) 0%, transparent 100%)',
        gap: 0,
        flexShrink: 0,
      }}
    >
      {LAYER_CELLS.map((cell) => (
        <span
          key={cell.label}
          data-testid={`tree-layer-cell-${cell.label.toLowerCase().replace(/[^a-z]/g, '')}`}
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 9,
            fontWeight: 500,
            letterSpacing: '0.04em',
            color: cell.color,
            opacity: 0.7,
            marginLeft: cell.marginLeft,
          }}
        >
          {cell.label}
        </span>
      ))}
    </div>
  )
}
