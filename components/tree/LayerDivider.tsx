// Spec: stelavox_component_specification_v2_0.md §4.7 (LayerDivider)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.5
//
// Subtle visual separator between structural layers in the tree.
// Rendered by NodeRow above the first child of each parent — the
// label identifies what layer those children belong to.

interface LayerDividerProps {
  label: string
}

export function LayerDivider({ label }: LayerDividerProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        padding: '12px 8px 4px',
        borderTop: '1px solid var(--color-border-subtle)',
      }}
    >
      <span
        style={{
          fontFamily: 'inherit',
          fontWeight: 500,
          fontSize: '9px',
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: 'var(--color-text-muted)',
        }}
      >
        {label}
      </span>
    </div>
  )
}
