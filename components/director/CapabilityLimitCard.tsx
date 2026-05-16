/**
 * CapabilityLimitCard — Director self-rejection surface (V1.x-F.1).
 *
 * Source: docs/wireframes/wireframe_failure_mode_ux_v1.html §01.
 * Spec: Component Spec §17.12 (V1.x-F).
 *
 * Renders in the Director conversation thread when the Director invokes
 * report_capability_limit. Shows the detected limit + the model's
 * suggested alternative + an "Adjust request" text-link affordance.
 *
 * Inviolables: Inter only; --color-info border (NOT --color-error —
 * this is the Director recognising its own limits, not a failure); the
 * "Adjust request" link is text-only with a subtle bottom border, NOT
 * verdigris (there is no approval; the user reformulates their request
 * manually). Verdigris-use count unchanged.
 */

'use client'

import type { CapabilityLimitProposalArtefact } from '@/lib/director/parse-message-proposals'

interface CapabilityLimitCardProps {
  proposal: CapabilityLimitProposalArtefact
  onAdjust?: () => void
}

const DETECTED_LIMIT_LABEL: Record<CapabilityLimitProposalArtefact['detected_limit'], string> = {
  per_iteration_cap: 'per-iteration node cap',
  token_budget: 'token-budget headroom',
  tool_count: 'tool-count overflow',
  other: 'capability boundary',
}

export function CapabilityLimitCard({ proposal, onAdjust }: CapabilityLimitCardProps) {
  return (
    <div
      data-testid="capability-limit-card"
      style={{
        border: '1px solid var(--color-border-subtle)',
        borderLeft: '3px solid var(--color-info)',
        borderRadius: '4px',
        padding: 'var(--space-3) var(--space-4)',
        background: 'var(--color-bg-base)',
        marginTop: 'var(--space-2)',
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
      }}
    >
      <div
        style={{
          fontSize: '10px',
          fontWeight: 500,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--color-info)',
          marginBottom: 'var(--space-2)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
        }}
      >
        <span style={{ fontSize: '14px' }} aria-hidden>⚠</span>
        <span>Capability limit</span>
      </div>

      <div
        style={{
          fontSize: '13px',
          fontWeight: 500,
          color: 'var(--color-text-primary)',
          marginBottom: 'var(--space-2)',
        }}
      >
        Detected: {DETECTED_LIMIT_LABEL[proposal.detected_limit]}
      </div>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          marginBottom: 'var(--space-3)',
          lineHeight: 1.6,
        }}
      >
        {proposal.reason}
      </div>

      <div
        style={{
          background: 'var(--color-bg-elevated)',
          borderLeft: '2px solid var(--color-info)',
          padding: 'var(--space-2) var(--space-3)',
          marginBottom: 'var(--space-3)',
          borderRadius: '3px',
        }}
      >
        <div
          style={{
            fontSize: '9px',
            fontWeight: 500,
            letterSpacing: '0.2em',
            textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
            marginBottom: '4px',
          }}
        >
          Suggested alternative
        </div>
        <div style={{ fontSize: '12px', color: 'var(--color-text-primary)', lineHeight: 1.55 }}>
          {proposal.suggested_alternative}
        </div>
      </div>

      <button
        type="button"
        onClick={onAdjust}
        data-testid="capability-limit-adjust"
        style={{
          fontSize: '12px',
          fontWeight: 400,
          color: 'var(--color-text-primary)',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--color-border-strong)',
          padding: '4px 0',
          cursor: 'pointer',
        }}
      >
        Adjust request →
      </button>
    </div>
  )
}
