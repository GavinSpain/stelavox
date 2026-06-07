// Phase 8.01 wireframe-alignment round 2 — Filter chips row above the
// tree.
//
// Visual chrome only. The actual filtering logic — narrowing the tree
// by Incomplete / Pending review / Running — is a Phase 8.03 item
// (node tree filtering). The chips render with a placeholder banner
// declaring the deferral so the chrome is honest about what it does.
//
// The `Find a node ⌘F` search affordance on the right is similarly
// chrome only until Phase 8.1 wires up the command-palette layer.
//
// Inviolable #2: no verdigris in this file (filter chips are
// navigation chrome; active state uses --color-bg-selected, not
// --color-accent).

interface FilterChipsRowProps {
  /** Total node count — drives the "All" chip's count badge. */
  totalNodes?: number
}

export function FilterChipsRow({ totalNodes }: FilterChipsRowProps) {
  return (
    <div
      data-testid="filter-chips-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 20px',
        borderBottom: '1px solid var(--color-border-subtle)',
        flexShrink: 0,
        background: 'var(--color-bg-base)',
      }}
    >
      <FilterChip label="All" count={totalNodes} active />
      <FilterChip label="Incomplete" />
      <FilterChip label="Pending review" />
      <FilterChip label="Running" />

      {/* Phase 8.03 placeholder banner */}
      <span
        data-testid="filter-deferred-banner"
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 9.5,
          letterSpacing: '0.04em',
          color: 'var(--color-text-disabled)',
          padding: '2px 7px',
          border: '1px dashed var(--color-border-default)',
          borderRadius: 3,
          textTransform: 'uppercase',
        }}
      >
        Filtering — Phase 8.03
      </span>

      <div style={{ flex: 1 }} aria-hidden />

      {/* Find a node ⌘F — chrome only until Phase 8.1 command palette */}
      <span
        data-testid="filter-find-box"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 10px',
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 4,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 11,
          color: 'var(--color-text-muted)',
          opacity: 0.85,
        }}
      >
        <span aria-hidden style={{ fontSize: 10 }}>⌕</span>
        <span>Find a node</span>
        <kbd
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 9.5,
            color: 'var(--color-text-muted)',
            marginLeft: 4,
          }}
        >
          ⌘F
        </kbd>
      </span>
    </div>
  )
}

function FilterChip({
  label,
  count,
  active = false,
}: {
  label: string
  count?: number
  active?: boolean
}) {
  return (
    <button
      type="button"
      role="button"
      data-testid={`filter-chip-${label.toLowerCase().replace(/\s+/g, '-')}`}
      data-active={active ? 'true' : 'false'}
      disabled={!active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        background: active ? 'var(--color-bg-selected)' : 'transparent',
        border: '1px solid',
        borderColor: active ? 'var(--color-border-strong)' : 'var(--color-border-subtle)',
        borderRadius: 4,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        fontWeight: 500,
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
        cursor: active ? 'pointer' : 'not-allowed',
        opacity: active ? 1 : 0.5,
      }}
    >
      {label}
      {typeof count === 'number' && (
        <span
          style={{
            fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
            fontSize: 9.5,
            color: 'var(--color-text-muted)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
    </button>
  )
}
