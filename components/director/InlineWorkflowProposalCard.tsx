'use client'

// Spec: stelavox_component_specification_v2_10.md v2.21 §18.5.
//       stelavox_phase8_01_C_build_checklist_v1_0.md T-4.
//
// Lighter sibling of PlanCard (§7.6). Mounts INSIDE the conversation
// thread per message so the author can Approve without leaving the
// Director view. PlanCard remains the authoritative detail-panel dispatch
// surface — both surfaces coexist; either can fire Approve via the same
// underlying handler.
//
// Inviolable #2: 1px LEFT border in --color-accent (verdigris use #7
//   affirmative-action triggers family — same category as PlanCard Approve
//   and Send. NO new category, NO Inviolable broadening.)
// Inviolable #4: Inter for structural text. The target labels use the
//   universal LayerLabel monospace per §18.1 — same exception established
//   for tree rows and breadcrumbs.

import type { WorkflowProposalParsed } from '@/lib/director/schemas'

interface InlineWorkflowProposalCardProps {
  workflowProposal: WorkflowProposalParsed
  onApprove: () => void
  /** Optional. If absent, no Modify link is rendered. */
  onModify?: () => void
  /** Disabled state, e.g. while approval is in-flight. */
  disabled?: boolean
}

// Operation labels per Director config — these match the labels used in
// PlanCard. Centralised so consumers don't drift.
const OPERATION_LABEL: Record<string, string> = {
  expand: 'Expand',
  synthesise: 'Synthesise',
  refine: 'Refine',
  generate_context: 'Generate context',
  comment: 'Comment',
  node_reorder: 'Reorder',
}

export function InlineWorkflowProposalCard({
  workflowProposal,
  onApprove,
  onModify,
  disabled = false,
}: InlineWorkflowProposalCardProps) {
  const steps = workflowProposal.steps ?? []
  return (
    <div
      data-testid="inline-workflow-proposal"
      style={{
        borderLeft: '1px solid var(--color-accent)',
        background: 'var(--color-bg-elevated)',
        borderRadius: 12,
        padding: '14px 16px',
        marginTop: 10,
        marginBottom: 10,
        // Match the conversation thread's max-width (OQ-2 lock — message width).
        maxWidth: '100%',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontWeight: 500,
          fontSize: 14,
          color: 'var(--color-text-primary)',
          marginBottom: 6,
        }}
      >
        {workflowProposal.title}
      </div>
      {workflowProposal.description && (
        <div
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: 12.5,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.55,
            marginBottom: 10,
          }}
        >
          {workflowProposal.description}
        </div>
      )}
      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          marginBottom: 12,
        }}
      >
        {steps.map((step, i) => (
          <li
            key={i}
            data-testid="inline-workflow-step"
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12.5,
              color: 'var(--color-text-primary)',
              lineHeight: 1.5,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                fontSize: 10.5,
                color: 'var(--color-text-muted)',
                letterSpacing: '0.02em',
                minWidth: 18,
                textAlign: 'right',
              }}
            >
              {i + 1}.
            </span>
            <span
              style={{
                fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
                fontSize: 10.5,
                padding: '1px 5px',
                border: '1px solid var(--color-border-default)',
                borderRadius: 3,
                color: 'var(--color-text-primary)',
                flexShrink: 0,
              }}
            >
              {OPERATION_LABEL[step.operation_type] ?? step.operation_type}
            </span>
            <span style={{ flex: 1 }}>{step.description}</span>
          </li>
        ))}
      </ol>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {onModify ? (
          <button
            type="button"
            data-testid="inline-workflow-modify"
            onClick={onModify}
            disabled={disabled}
            style={{
              background: 'transparent',
              border: 0,
              padding: 0,
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12.5,
              cursor: disabled ? 'not-allowed' : 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
            }}
          >
            Modify
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          data-testid="inline-workflow-approve"
          onClick={onApprove}
          disabled={disabled}
          style={{
            background: 'var(--color-accent)',
            color: 'var(--color-bg-base)',
            border: 0,
            borderRadius: 6,
            padding: '8px 16px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontWeight: 500,
            fontSize: 13,
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          Approve
        </button>
      </div>
    </div>
  )
}
