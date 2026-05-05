'use client'

/**
 * AgentTab — the per-node agent operations panel.
 *
 * Source: stelavox_component_specification_v2_6.md §5.9
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §3.1–§3.8
 *         stelavox_phase5_test_plan_v1_0.md TC-U-01..TC-U-14, TC-V-03
 * Build Checklist T-11.1, T-11.2.
 *
 * Five states cycling on a single node:
 *   IDLE      — no active job; show profile picker, instruction textarea,
 *               operation buttons.
 *   ACTIVE    — pending|running job; show progress bar + token count + Stop.
 *   COMPLETE  — completed job awaiting Accept/Dismiss; show preview +
 *               verdigris Accept (verdigris use #7) + Dismiss buttons.
 *   FAILED    — failed job; show error_message + Dismiss button.
 *   (no job)  — IDLE rendering.
 *
 * The component reads job state from useActiveJobForNode (real-time).
 * Operation triggers POST to /api/agent/<op>; lifecycle actions POST to
 * /api/agent-jobs/[id]/{cancel,accept,dismiss}.
 */

import { useState, useEffect } from 'react'
import { useActiveJobForNode, type AgentJob } from '@/lib/hooks/useAgentJobsRealtime'

interface AgentTabProps {
  nodeId: string
  nodeType: string
  nodeCategory: 'structural' | 'context'
  isLeaf: boolean
}

interface AgentProfile {
  id: string
  name: string
  operation_type: string
  node_type: string | null
}

const OPERATION_BUTTONS: Array<{
  op: 'expand' | 'synthesise' | 'refine' | 'generate_context'
  label: string
  icon: string
  fullWidth?: boolean
}> = [
  { op: 'expand',    label: 'Expand',    icon: '⚡' },
  { op: 'refine',    label: 'Refine',    icon: '✏' },
  { op: 'synthesise', label: 'Synthesise Prose', icon: '✨', fullWidth: true },
]

export function AgentTab({ nodeId, nodeType, nodeCategory, isLeaf }: AgentTabProps) {
  const activeJob = useActiveJobForNode(nodeId)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [instruction, setInstruction] = useState('')
  const [refineField, setRefineField] = useState<'summary' | 'prose' | 'notes'>('summary')
  const [refinementInstruction, setRefinementInstruction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Load profiles applicable to this node type
  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams()
      if (nodeType) params.set('node_type', nodeType)
      const res = await fetch(`/api/agent-profiles?${params.toString()}`)
      if (!res.ok) return
      const json = (await res.json()) as { agent_profiles: AgentProfile[] }
      setProfiles(json.agent_profiles)
    })()
  }, [nodeType])

  async function trigger(op: 'expand' | 'synthesise' | 'refine' | 'generate_context') {
    setError(null)
    setBusy(true)
    try {
      const body: Record<string, unknown> = { node_id: nodeId }
      if (selectedProfileId) body.profile_id = selectedProfileId
      if (instruction.trim()) body.agent_instruction = instruction.trim()
      if (op === 'refine') {
        body.target_field = refineField
        body.refinement_instruction = refinementInstruction.trim() || instruction.trim() || 'Improve.'
      }
      const res = await fetch(`/api/agent/${op === 'generate_context' ? 'generate-context' : op}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? `HTTP ${res.status}`)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function lifecycleAction(jobId: string, action: 'cancel' | 'accept' | 'dismiss') {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/agent-jobs/${jobId}/${action}`, { method: 'POST' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setError(json.error ?? `HTTP ${res.status}`)
        return
      }
      // No tree-refresh trigger needed here — NodeTree subscribes to the
      // nodes realtime channel via useNodesRealtime and refetches itself
      // when Accept's INSERTs land in the database. (SU-31 proper fix.)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  const padding = 'var(--space-5)'

  if (activeJob && (activeJob.status === 'pending' || activeJob.status === 'running')) {
    return <ActiveState job={activeJob} onCancel={() => lifecycleAction(activeJob.id, 'cancel')} busy={busy} />
  }

  if (activeJob && activeJob.status === 'completed') {
    return (
      <CompleteState
        job={activeJob}
        busy={busy}
        onAccept={() => lifecycleAction(activeJob.id, 'accept')}
        onDismiss={() => lifecycleAction(activeJob.id, 'dismiss')}
      />
    )
  }

  // IDLE — show operation panel
  const refineCapable = nodeCategory === 'structural' || nodeCategory === 'context'
  const expandCapable = nodeCategory === 'structural' && !isLeaf
  const synthesiseCapable = nodeCategory === 'structural' && isLeaf
  const generateContextCapable = nodeCategory === 'context'

  return (
    <div style={{ padding, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div>
        <Label>Profile</Label>
        <select
          value={selectedProfileId}
          onChange={(e) => setSelectedProfileId(e.target.value)}
          disabled={busy}
          style={selectStyle}
        >
          <option value="">— default for node type —</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.operation_type})
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Instruction (optional)</Label>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. focus on character interiority"
          rows={3}
          disabled={busy}
          style={textareaStyle}
        />
      </div>

      {refineCapable && (
        <div>
          <Label>Refine target</Label>
          <select
            value={refineField}
            onChange={(e) => setRefineField(e.target.value as 'summary' | 'prose' | 'notes')}
            disabled={busy}
            style={selectStyle}
          >
            <option value="summary">summary</option>
            <option value="prose" disabled={!isLeaf}>prose {isLeaf ? '' : '(leaf-only)'}</option>
            <option value="notes">notes</option>
          </select>
          <textarea
            value={refinementInstruction}
            onChange={(e) => setRefinementInstruction(e.target.value)}
            placeholder="What should the refine change?"
            rows={2}
            disabled={busy}
            style={{ ...textareaStyle, marginTop: 'var(--space-2)' }}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {expandCapable && (
          <OpButton
            op="expand"
            label="Expand"
            icon="⚡"
            disabled={busy}
            onClick={() => trigger('expand')}
          />
        )}
        {refineCapable && (
          <OpButton
            op="refine"
            label="Refine"
            icon="✏"
            disabled={busy || !refinementInstruction.trim()}
            onClick={() => trigger('refine')}
          />
        )}
        {generateContextCapable && (
          <OpButton
            op="generate_context"
            label="Generate context"
            icon="◆"
            disabled={busy}
            onClick={() => trigger('generate_context')}
          />
        )}
        {synthesiseCapable && (
          <OpButton
            op="synthesise"
            label="✨ Synthesise Prose"
            icon=""
            fullWidth
            disabled={busy}
            onClick={() => trigger('synthesise')}
          />
        )}
        {/* Critique button — V1.x; rendered disabled per Component Spec §5.9 layout */}
        <OpButton op="expand" label="Critique" icon="🔍" disabled tooltip="Critique is V1.x — coming soon" onClick={() => {}} />
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: 'block',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: '11px',
        fontWeight: 500,
        color: 'var(--color-text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        marginBottom: 'var(--space-2)',
      }}
    >
      {children}
    </label>
  )
}

function ErrorBanner({ error, onDismiss }: { error: string | null; onDismiss: () => void }) {
  if (!error) return null
  return (
    <div
      style={{
        padding: 'var(--space-3)',
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-error)',
        borderRadius: '4px',
        color: 'var(--color-error)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{error}</span>
      <button
        onClick={onDismiss}
        style={{ background: 'none', border: 'none', color: 'var(--color-error)', cursor: 'pointer', fontSize: '14px' }}
      >×</button>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  fontSize: '13px',
  padding: '6px 8px',
  background: 'var(--color-bg-base)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '4px',
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-inter), Inter, sans-serif',
  fontWeight: 300,
  fontSize: '12px',
  padding: '6px 8px',
  background: 'var(--color-bg-base)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: '4px',
  resize: 'vertical',
}

function OpButton({
  label,
  icon,
  disabled,
  fullWidth,
  tooltip,
  onClick,
}: {
  op: string
  label: string
  icon: string
  disabled?: boolean
  fullWidth?: boolean
  tooltip?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      style={{
        background: 'var(--color-agent-running)',
        color: 'white',
        border: 'none',
        borderRadius: '4px',
        padding: '8px 12px',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: '11px',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        width: fullWidth ? '100%' : 'auto',
      }}
    >
      {icon ? `${icon} ${label}` : label}
    </button>
  )
}

function ActiveState({ job, onCancel, busy }: { job: AgentJob; onCancel: () => void; busy: boolean }) {
  const tokensIn = job.tokens_input ?? 0
  const tokensOut = job.tokens_output ?? 0

  // Indeterminate progress bar — a sliding stripe animated via CSS @keyframes
  // (defined in styles/tokens.css). LLM operations don't expose true progress
  // (we get tokens AFTER the call completes, not during), so a percentage-
  // based bar would always be misleading. The indeterminate sweep
  // communicates "running, no ETA" honestly.
  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div
          style={{
            height: '3px',
            background: 'var(--color-bg-base)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '2px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            className="agent-progress-indeterminate"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              height: '100%',
              width: '40%',
              background: 'var(--color-agent-running)',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 'var(--space-2)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '10px',
            fontWeight: 300,
            color: 'var(--color-text-muted)',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <span>
            {job.operation_type} · {job.status} · {job.model_id ?? ''}
          </span>
          <span>
            in: {tokensIn.toLocaleString()} · out: {tokensOut.toLocaleString()}
          </span>
        </div>
      </div>
      <button
        onClick={onCancel}
        disabled={busy}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--color-error)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '11px',
          cursor: busy ? 'not-allowed' : 'pointer',
          alignSelf: 'flex-start',
        }}
      >
        Stop
      </button>
    </div>
  )
}

function CompleteState({
  job,
  onAccept,
  onDismiss,
  busy,
}: {
  job: AgentJob
  onAccept: () => void
  onDismiss: () => void
  busy: boolean
}) {
  const previewLines = describeResult(job)
  const cost = job.cost_usd != null ? `$${job.cost_usd.toFixed(4)}` : '—'
  return (
    <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div
        style={{
          padding: 'var(--space-3)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          background: 'var(--color-bg-base)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          maxHeight: '300px',
          overflow: 'auto',
        }}
      >
        <div style={{ fontWeight: 500, marginBottom: 'var(--space-2)' }}>
          {job.operation_type} complete · {cost} · {job.tokens_output ?? 0} output tokens
        </div>
        <pre
          style={{
            fontFamily: 'var(--font-mono), Geist Mono, monospace',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}
        >
          {previewLines}
        </pre>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          onClick={onAccept}
          disabled={busy}
          style={{
            // Verdigris use #7 — the Accept button (Inviolable #2)
            background: 'var(--color-accent)',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '8px 16px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            fontWeight: 500,
            cursor: busy ? 'not-allowed' : 'pointer',
            flex: 1,
            opacity: busy ? 0.6 : 1,
          }}
        >
          Accept
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          style={{
            background: 'transparent',
            color: 'var(--color-text-muted)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            padding: '8px 16px',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            fontWeight: 500,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function describeResult(job: AgentJob): string {
  if (job.result_child_nodes && Array.isArray(job.result_child_nodes)) {
    const items = job.result_child_nodes as Array<{ name?: string; short_description?: string }>
    return items
      .map((c, i) => `${i + 1}. ${c.name ?? '(unnamed)'}\n   ${c.short_description ?? ''}`)
      .join('\n\n')
  }
  if (job.result_prose) return job.result_prose.slice(0, 600) + (job.result_prose.length > 600 ? '…' : '')
  if (job.result_summary) return job.result_summary.slice(0, 600) + (job.result_summary.length > 600 ? '…' : '')
  if (job.result_notes) return job.result_notes
  if (job.result_metadata) return JSON.stringify(job.result_metadata, null, 2)
  return '(no result)'
}
