'use client'

// Spec: stelavox_component_specification_v2_7.md §7.6 (PlanCard)
//       stelavox_phase5b_api_contract_v1_0.md §3.6, §3.7
//       stelavox_phase5b_build_checklist_v1_0.md §3.15 T-15.1
//
// The plan-approval gate. Always fully expanded (no expand-on-click).
// Per-step checkbox + remove × button + optional inline instruction
// edit. Locked-node warning when applicable. Approve / Edit Steps /
// Cancel footer with live-updating Approve label.
//
// Inviolable #2: --color-accent appears in #7 (Accept/Approve button
// background) and step checkbox checked-state. No other accent uses
// in this file.
//
// Nothing executes until Approve POSTs to /approve. Backend marks
// non-selected steps `removed` atomically before transitioning the
// workflow to `approved`.

import { useMemo, useState } from 'react'
import type { WorkflowDto, WorkflowStepDto } from '@/lib/hooks/useDirectorConversation'

interface PlanCardProps {
  workflow: WorkflowDto
  onApproved?: (workflow: WorkflowDto) => void
  onCancelled?: (workflow: WorkflowDto) => void
}

type DraftStep = WorkflowStepDto & {
  selected: boolean
  removedLocally: boolean
  instructionOverride: string | null
}

function operationLabel(t: string): string {
  switch (t) {
    case 'expand':           return 'Expand'
    case 'synthesise':       return 'Synthesise'
    case 'refine':           return 'Refine'
    case 'generate_context': return 'Generate context'
    case 'comment':          return 'Comment'
    case 'node_reorder':     return 'Reorder'
    default:                 return t
  }
}

function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  if (seconds < 60) return `~${Math.round(seconds)}s`
  return `~${Math.round(seconds / 60)}m`
}

export function PlanCard({ workflow, onApproved, onCancelled }: PlanCardProps) {
  // Local draft view: each step starts selected unless its server
  // status is already `removed` (Director sometimes proposes a step
  // and immediately marks it removed if guardrails fired).
  const [drafts, setDrafts] = useState<DraftStep[]>(
    () =>
      workflow.steps
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((s) => ({
          ...s,
          selected: s.status !== 'removed',
          removedLocally: s.status === 'removed',
          instructionOverride: null,
        })),
  )
  const [editMode, setEditMode] = useState(false)
  const [submitting, setSubmitting] = useState<'approve' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = drafts.filter((d) => !d.removedLocally)
  const selectedCount = visible.filter((d) => d.selected).length
  const totalCount = visible.length
  const allSelected = selectedCount > 0 && selectedCount === totalCount

  const lockedRequiringUnlock = workflow.locked_nodes_requiring_unlock ?? []

  function toggleSelect(order: number) {
    setDrafts((prev) =>
      prev.map((d) => (d.order === order ? { ...d, selected: !d.selected } : d)),
    )
  }

  function removeStep(order: number) {
    setDrafts((prev) =>
      prev.map((d) =>
        d.order === order
          ? { ...d, removedLocally: true, selected: false }
          : d,
      ),
    )
  }

  function setOverride(order: number, value: string) {
    setDrafts((prev) =>
      prev.map((d) => (d.order === order ? { ...d, instructionOverride: value } : d)),
    )
  }

  async function handleApprove() {
    if (submitting) return
    setSubmitting('approve')
    setError(null)
    const approvedOrders = visible.filter((d) => d.selected).map((d) => d.order)
    const overrides: Record<string, Record<string, unknown>> = {}
    for (const d of visible) {
      if (d.instructionOverride !== null && d.instructionOverride.trim().length > 0) {
        overrides[String(d.order)] = {
          ...d.parameters,
          instruction: d.instructionOverride,
        }
      }
    }
    try {
      const res = await fetch(`/api/director/workflows/${workflow.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approved_step_orders: approvedOrders,
          step_parameter_overrides:
            Object.keys(overrides).length > 0 ? overrides : undefined,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { workflow: WorkflowDto }
      onApproved?.(json.workflow)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approve failed')
    } finally {
      setSubmitting(null)
    }
  }

  async function handleCancel() {
    if (submitting) return
    setSubmitting('cancel')
    setError(null)
    try {
      const res = await fetch(`/api/director/workflows/${workflow.id}/cancel`, {
        method: 'POST',
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          message?: string
        }
        throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { workflow: WorkflowDto }
      onCancelled?.(json.workflow)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setSubmitting(null)
    }
  }

  const approveLabel = useMemo(() => {
    if (selectedCount === 0) return 'Approve 0 of ' + totalCount
    if (allSelected) return 'Approve All'
    return `Approve ${selectedCount} of ${totalCount}`
  }, [selectedCount, totalCount, allSelected])

  return (
    <div
      data-testid="plan-card"
      role="group"
      aria-label="Workflow plan"
      style={{
        border: '1px solid var(--color-border-default)',
        borderRadius: 6,
        background: 'var(--color-bg-surface)',
        overflow: 'hidden',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <Header
        title={workflow.title || 'Plan'}
        stepCount={totalCount}
        durationMinutes={workflow.estimated_total_minutes}
      />
      {workflow.description ? (
        <Description text={workflow.description} />
      ) : null}
      {workflow.impact_summary ? (
        <ImpactSummary text={workflow.impact_summary} />
      ) : null}

      <ol
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
        }}
      >
        {visible.map((step) => (
          <li
            key={step.order}
            style={{
              display: 'flex',
              flexDirection: 'column',
              padding: '8px 14px',
              minHeight: 44,
              borderBottom: '1px solid var(--color-border-subtle)',
              opacity: step.selected ? 1 : 0.55,
              transition: 'opacity var(--duration-fast) var(--easing-smooth)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <Checkbox
                checked={step.selected}
                onToggle={() => toggleSelect(step.order)}
                ariaLabel={`Step ${step.order}: ${operationLabel(step.operation_type)} ${step.target_node_label}`}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    fontSize: 11,
                    color: step.selected
                      ? 'var(--color-text-primary)'
                      : 'var(--color-text-muted)',
                    lineHeight: 1.4,
                  }}
                >
                  {operationLabel(step.operation_type)} ·{' '}
                  <span style={{ fontWeight: 400 }}>{step.target_node_label}</span>
                </div>
                <div
                  style={{
                    fontWeight: 300,
                    fontSize: 11,
                    color: step.selected
                      ? 'var(--color-text-secondary)'
                      : 'var(--color-text-muted)',
                    lineHeight: 1.5,
                    marginTop: 2,
                  }}
                >
                  {step.description}
                </div>
                <div
                  style={{
                    marginTop: 4,
                    fontWeight: 300,
                    fontSize: 10,
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {durationLabel(step.estimated_duration_seconds)}
                  {step.depends_on_step_orders.length > 0 ? (
                    <>
                      {' · after step '}
                      {step.depends_on_step_orders.join(', ')}
                    </>
                  ) : null}
                </div>
                {editMode &&
                step.selected &&
                typeof step.parameters?.instruction === 'string' ? (
                  <textarea
                    value={
                      step.instructionOverride ??
                      String(step.parameters.instruction ?? '')
                    }
                    onChange={(e) => setOverride(step.order, e.target.value)}
                    rows={2}
                    style={{
                      marginTop: 8,
                      width: '100%',
                      fontFamily: 'var(--font-inter), Inter, sans-serif',
                      fontWeight: 300,
                      fontSize: 11,
                      color: 'var(--color-text-primary)',
                      background: 'var(--color-bg-base)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 4,
                      padding: '6px 8px',
                      resize: 'vertical',
                      minHeight: 44,
                    }}
                  />
                ) : null}
              </div>
              <button
                type="button"
                aria-label={`Remove step ${step.order}`}
                title="Remove from plan"
                onClick={() => removeStep(step.order)}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontSize: 14,
                  lineHeight: 1,
                  padding: 4,
                }}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>

      {lockedRequiringUnlock.length > 0 ? (
        <LockWarningRow nodeIds={lockedRequiringUnlock} />
      ) : null}

      {error ? (
        <div
          role="alert"
          style={{
            padding: '8px 14px',
            background: 'rgba(184,48,48,0.08)',
            borderTop: '1px solid rgba(184,48,48,0.25)',
            fontSize: 11,
            color: 'var(--color-text-primary)',
          }}
        >
          {error}
        </div>
      ) : null}

      <Footer
        approveLabel={approveLabel}
        approveDisabled={
          selectedCount === 0 ||
          submitting !== null ||
          lockedRequiringUnlock.length > 0
        }
        editMode={editMode}
        onToggleEdit={() => setEditMode((v) => !v)}
        onApprove={handleApprove}
        onCancel={handleCancel}
        approving={submitting === 'approve'}
        cancelling={submitting === 'cancel'}
      />
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────

function Header({
  title,
  stepCount,
  durationMinutes,
}: {
  title: string
  stepCount: number
  durationMinutes: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 14px',
        background: 'var(--color-bg-base)',
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      <h3
        style={{
          margin: 0,
          fontWeight: 600,
          fontSize: 12,
          color: 'var(--color-text-primary)',
        }}
      >
        {title}
      </h3>
      <span
        style={{
          marginLeft: 'auto',
          fontWeight: 300,
          fontSize: 10,
          color: 'var(--color-text-muted)',
        }}
      >
        {stepCount} {stepCount === 1 ? 'step' : 'steps'}
        {durationMinutes > 0 ? ` · ~${durationMinutes}m` : ''}
      </span>
    </div>
  )
}

function Description({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '8px 14px',
        fontWeight: 300,
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        lineHeight: 1.5,
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {text}
    </div>
  )
}

function ImpactSummary({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: '6px 14px 10px',
        fontWeight: 300,
        fontSize: 10,
        color: 'var(--color-text-muted)',
        lineHeight: 1.5,
        borderBottom: '1px solid var(--color-border-subtle)',
      }}
    >
      {text}
    </div>
  )
}

function Checkbox({
  checked,
  onToggle,
  ariaLabel,
}: {
  checked: boolean
  onToggle: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      data-testid="plan-card-step-checkbox"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onToggle}
      style={{
        width: 14,
        height: 14,
        marginTop: 1,
        flexShrink: 0,
        border: checked
          ? '1px solid var(--color-accent)'
          : '1px solid var(--color-border-default)',
        borderRadius: 2,
        background: checked ? 'var(--color-accent)' : 'transparent',
        color: '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 9,
        lineHeight: 1,
        cursor: 'pointer',
        padding: 0,
      }}
    >
      {checked ? '✓' : ''}
    </button>
  )
}

function LockWarningRow({ nodeIds }: { nodeIds: string[] }) {
  return (
    <div
      role="alert"
      style={{
        padding: '8px 14px',
        background: 'rgba(184,112,48,0.08)',
        borderTop: '1px solid rgba(184,112,48,0.2)',
        fontWeight: 300,
        fontSize: 11,
        color: 'var(--color-status-review, #b87030)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span aria-hidden="true">⚠</span>
      <span>
        {nodeIds.length === 1
          ? '1 locked node is in scope. Unlock it before approving.'
          : `${nodeIds.length} locked nodes are in scope. Unlock them before approving.`}
      </span>
    </div>
  )
}

function Footer({
  approveLabel,
  approveDisabled,
  editMode,
  onToggleEdit,
  onApprove,
  onCancel,
  approving,
  cancelling,
}: {
  approveLabel: string
  approveDisabled: boolean
  editMode: boolean
  onToggleEdit: () => void
  onApprove: () => void
  onCancel: () => void
  approving: boolean
  cancelling: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 14px',
        background: 'var(--color-bg-base)',
        borderTop: '1px solid var(--color-border-subtle)',
      }}
    >
      <button
        type="button"
        data-testid="plan-card-approve-btn"
        onClick={onApprove}
        disabled={approveDisabled}
        style={{
          background: 'var(--color-accent)',
          color: '#ffffff',
          border: 'none',
          borderRadius: 4,
          padding: '6px 14px',
          fontWeight: 500,
          fontSize: 11,
          cursor: approveDisabled ? 'not-allowed' : 'pointer',
          opacity: approveDisabled ? 0.55 : 1,
        }}
      >
        {approving ? 'Approving…' : approveLabel}
      </button>
      <button
        type="button"
        onClick={onToggleEdit}
        style={{
          background: editMode ? 'var(--color-bg-elevated)' : 'transparent',
          color: 'var(--color-text-secondary)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 4,
          padding: '6px 12px',
          fontWeight: 400,
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {editMode ? 'Done editing' : 'Edit Steps'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={cancelling}
        style={{
          marginLeft: 'auto',
          background: 'transparent',
          color: 'var(--color-text-muted)',
          border: 'none',
          fontWeight: 300,
          fontSize: 11,
          cursor: cancelling ? 'not-allowed' : 'pointer',
          padding: '6px 4px',
        }}
      >
        {cancelling ? 'Cancelling…' : '✕ Cancel'}
      </button>
    </div>
  )
}
