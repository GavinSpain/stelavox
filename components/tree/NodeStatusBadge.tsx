// Spec: stelavox_component_specification_v2_0.md §4.3 (NodeStatusBadge)
//       stelavox_brand_identity_v2_0.md §5.1 (verdigris reservation #5)
//       Phase 6 wireframe §02 — status reduces to {draft, approved}
//
// 8×8px circle, right-aligned in the row before the hover actions.
// Status changes are instant (0ms) — status is information, not an
// event. Per Component Spec, the badge has no ARIA role; the parent
// row's aria-label conveys status.
//
// Phase 6: status enum reduced from 4 values to 2. `in_review` was
// vestigial (no user story); `locked` collapsed into Author Lock
// which is its own axis (Category 1 of three lock-like primitives).
//
// Inviolable #2: this component is the ONLY place
// `--color-status-approved` (verdigris reservation #5) is introduced
// in Phase 2+. The `draft` colour is non-verdigris.

const STATUS_COLOURS: Record<string, string> = {
  draft:    'var(--color-status-draft)',
  approved: 'var(--color-status-approved)',  // verdigris #5
}

interface NodeStatusBadgeProps {
  status: string
}

export function NodeStatusBadge({ status }: NodeStatusBadgeProps) {
  const colour = STATUS_COLOURS[status] ?? 'var(--color-status-draft)'
  return (
    <span
      data-testid="node-status-badge"
      data-status={status}
      aria-hidden="true"
      style={{
        display: 'inline-block',
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: colour,
        flexShrink: 0,
      }}
    />
  )
}
