'use client'

/**
 * V1.x-D.3 — WorkflowCompletionAck.
 *
 * Source: Component Spec §17.11 · wireframe_director_completion_v1.html.
 *
 * Mechanical workflow-complete acknowledgement line. Renders inline
 * after the PlanCard / ExecutionCard when a workflow has reached a
 * terminal state (completed / partially_completed / failed).
 *
 * V1.x-D ships mechanical only — counts + status + navigation. V2
 * candidate: reflective acknowledgement that re-reads artefacts and
 * surfaces an observation (deferred per Director Architecture v2.3
 * §16.3).
 *
 * Inviolable #2: success border uses --color-status-approved (verdigris
 * #4 — passive completion indicator, existing category). Partial uses
 * --color-status-review (attention-amber). Failure uses --color-error
 * (destructive). Verdigris-use count unchanged.
 */

interface WorkflowCompletionAckProps {
  status: string  // 'completed' | 'failed' | 'paused' | etc.
  stepsTotal: number
  stepsSucceeded: number
  stepsFailed: number
  /** Optional failure-class label for the failure branch (Class A/B/C/D/E). */
  failureClass?: string | null
}

export function WorkflowCompletionAck({
  status,
  stepsTotal,
  stepsSucceeded,
  stepsFailed,
  failureClass,
}: WorkflowCompletionAckProps) {
  // Only render on terminal states.
  if (status !== 'completed' && status !== 'failed' && status !== 'partially_completed') {
    return null
  }

  const isFullSuccess = status === 'completed' && stepsFailed === 0
  const isFullFailure = stepsSucceeded === 0
  const isPartial = !isFullSuccess && !isFullFailure

  // Border colour + glyph per variant.
  let borderColour: string
  let glyph: string
  let glyphColour: string
  if (isFullSuccess) {
    borderColour = 'var(--color-status-approved)'
    glyph = '●'
    glyphColour = 'var(--color-accent-hover)'
  } else if (isPartial) {
    borderColour = 'var(--color-status-review)'
    glyph = '◐'
    glyphColour = 'var(--color-status-review)'
  } else {
    borderColour = 'var(--color-error)'
    glyph = '○'
    glyphColour = 'var(--color-error)'
  }

  // Copy per variant.
  let copy: React.ReactNode
  if (isFullSuccess) {
    copy = (
      <>
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
          Workflow complete:
        </strong>{' '}
        {stepsSucceeded} of {stepsTotal} step{stepsTotal === 1 ? '' : 's'} succeeded.
        {stepsSucceeded > 0
          ? ' Review the changes in the tree — scenes marked with a dot have AI updates pending your review.'
          : ''}
      </>
    )
  } else if (isPartial) {
    copy = (
      <>
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
          Workflow ended with issues:
        </strong>{' '}
        {stepsSucceeded} of {stepsTotal} step{stepsTotal === 1 ? '' : 's'} succeeded. {stepsFailed} step
        {stepsFailed === 1 ? '' : 's'} failed
        {failureClass ? ` on ${failureClass}` : ''}. The successful steps are on your tree for review.
      </>
    )
  } else {
    copy = (
      <>
        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
          Workflow failed:
        </strong>{' '}
        0 of {stepsTotal} step{stepsTotal === 1 ? '' : 's'} succeeded.
        {failureClass ? ` ${failureClass}.` : ''}
      </>
    )
  }

  return (
    <div
      data-testid="workflow-completion-ack"
      data-status={isFullSuccess ? 'success' : isPartial ? 'partial' : 'failed'}
      role="status"
      style={{
        background: 'var(--color-bg-elevated)',
        borderLeft: `2px solid ${borderColour}`,
        borderRadius: 4,
        padding: '10px 14px',
        fontSize: 12,
        color: 'var(--color-text-secondary)',
        margin: '14px 0',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <span style={{ color: glyphColour, fontSize: 14, flexShrink: 0 }} aria-hidden="true">
        {glyph}
      </span>
      <span style={{ lineHeight: 1.5 }}>{copy}</span>
    </div>
  )
}
