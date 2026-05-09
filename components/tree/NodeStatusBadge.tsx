// Spec: stelavox_component_specification_v2_0.md §4.3 (NodeStatusBadge)
//       stelavox_brand_identity_v2_0.md §5.1 (verdigris reservations #4 and #5)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.4
//
// 8×8px circle, right-aligned in the row before the hover actions.
// Status changes are instant (0ms) — status is information, not an
// event. Per Component Spec, the badge has no ARIA role; the parent
// row's aria-label conveys status.
//
// Inviolable #2: this component is the ONLY place
// `--color-status-approved` (verdigris reservations #4 and #5) is
// introduced in Phase 2. Other status colours are non-verdigris.

const STATUS_COLOURS: Record<string, string> = {
  draft:     'var(--color-status-draft)',
  in_review: 'var(--color-status-review)',
  approved:  'var(--color-status-approved)',  // verdigris #4 and #5
  locked:    'var(--color-status-locked)',
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
