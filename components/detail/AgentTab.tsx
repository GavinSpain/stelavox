'use client'

/**
 * AgentTab — the per-node agent operations panel.
 *
 * Source: stelavox_component_specification_v2_9.md §5.9 (Phase 5c streaming
 *         subsection), §5.9 base (Phase 5 active/complete states).
 *         stelavox_phase5_api_contract_v1_0.md v1.2 §3.1–§3.8
 *         stelavox_phase5c_api_contract_v1_0.md §3.1 (synthesise streaming)
 *         stelavox_phase5_test_plan_v1_0.md TC-U-01..TC-U-14, TC-V-03
 *         stelavox_phase5c_test_plan_v1_0.md (TC-U cases for streaming UI)
 * Build Checklist: T-11.1, T-11.2 (Phase 5), T-6 (Phase 5c).
 *
 * States cycling on a single node:
 *   IDLE       — no active job; show profile picker, instruction textarea,
 *                operation buttons.
 *   STREAMING  — Phase 5c — synthesise SSE in progress; show typewriter
 *                surface accumulating text + Cancel button (in place of
 *                ActiveState's indeterminate progress).
 *   ACTIVE     — pending|running job (non-streaming or workflow-dispatched);
 *                show progress bar + token count + Stop.
 *   COMPLETE   — completed job awaiting Accept/Dismiss; show preview +
 *                verdigris Accept (verdigris use #7) + Dismiss buttons.
 *   FAILED     — failed job; show error_message + Dismiss button.
 *   (no job)   — IDLE rendering.
 *
 * The component reads job state from useActiveJobForNode (real-time) for
 * the non-streaming path and ACTIVE/COMPLETE/FAILED rendering. Streaming
 * synthesise additionally maintains local state during the SSE life:
 * `streamingStatus` + `streamingText` are cleared on `agent_job_complete`
 * so the CompleteState (driven by realtime) takes over the review surface.
 */

import { useState, useEffect, useRef } from 'react'
import { streamSynthesise } from '@/lib/agent/streamSynthesise'
import { useActiveJobForNode, type AgentJob } from '@/lib/hooks/useAgentJobsRealtime'

interface AgentTabProps {
  nodeId: string
  nodeType: string
  nodeCategory: 'structural' | 'context'
  isLeaf: boolean
  /**
   * Optional belt-and-braces tree-refresh callback. SU-J12-2 fix:
   * Realtime nodes-table broadcasts are the primary refresh path
   * (lib/hooks/useNodesRealtime), but in production they don't always
   * fire promptly after Accept on the deployed Vercel app (Mars-drive
   * 2026-05-09 reproduced 3x). Calling onMutated() on Accept
   * guarantees the tree refetches even when Realtime is delayed, at
   * the cost of one redundant fetch when Realtime works as expected.
   */
  onMutated?: () => void
}

interface AgentProfile {
  id: string
  name: string
  operation_type: string
  node_type: string | null
}

type StreamingStatus = 'idle' | 'connecting' | 'streaming' | 'errored' | 'cancelled'

export function AgentTab({ nodeId, nodeType, nodeCategory, isLeaf, onMutated }: AgentTabProps) {
  const activeJob = useActiveJobForNode(nodeId)
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState<string>('')
  const [instruction, setInstruction] = useState('')
  const [refineField, setRefineField] = useState<'summary' | 'prose' | 'notes'>('summary')
  const [refinementInstruction, setRefinementInstruction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Phase 5c — streaming synthesise state. Active only between the user's
  // click and the SSE `agent_job_complete` event. After completion, we
  // clear streamingStatus and the existing CompleteState (driven by the
  // realtime hook) takes over the review surface.
  const [streamingStatus, setStreamingStatus] = useState<StreamingStatus>('idle')
  const [streamingText, setStreamingText] = useState('')
  const cancelControllerRef = useRef<AbortController | null>(null)

  // Streaming state is naturally scoped to the AgentTab instance.
  // NodeDetailPanel passes `key={nodeId}` so React unmounts + remounts
  // this component on node change — that resets all local state cleanly
  // without an effect or ref, the React-canonical pattern for
  // "discard state when a prop changes."

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

    // Phase 5c — synthesise uses the foreground streaming endpoint
    // (POST /api/agent/synthesise/stream). Other operations stay on the
    // background path (POST /api/agent/<op>).
    if (op === 'synthesise') {
      await triggerSynthesiseStream()
      return
    }

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

  async function triggerSynthesiseStream() {
    setStreamingText('')
    setStreamingStatus('connecting')
    const controller = new AbortController()
    cancelControllerRef.current = controller

    try {
      await streamSynthesise(
        {
          nodeId,
          ...(selectedProfileId ? { profileId: selectedProfileId } : {}),
          ...(instruction.trim() ? { agentInstruction: instruction.trim() } : {}),
          signal: controller.signal,
        },
        {
          onJobCreated: () => setStreamingStatus('streaming'),
          onTextDelta: (delta) => {
            setStreamingText((prev) => prev + delta)
          },
          onJobComplete: () => {
            // Realtime on agent_jobs has already (or is about to) update
            // activeJob to status='completed'. Clearing streamingStatus
            // hands the surface back to CompleteState for review.
            setStreamingStatus('idle')
            setStreamingText('')
          },
          onError: (data) => {
            setError(data.message ?? data.error)
            setStreamingStatus('errored')
            setStreamingText('')
          },
          onDone: () => {
            // SSE close after agent_job_complete or error; no-op for the UI.
          },
        },
      )
    } catch (e) {
      // streamSynthesise's fetch can throw on AbortError when the user
      // cancels — that's expected, not an error to surface.
      if ((e as { name?: string }).name === 'AbortError') {
        setStreamingStatus('cancelled')
        setStreamingText('')
        return
      }
      setError((e as Error).message)
      setStreamingStatus('errored')
      setStreamingText('')
    } finally {
      cancelControllerRef.current = null
    }
  }

  function cancelStreamingSynthesise() {
    cancelControllerRef.current?.abort()
    setStreamingStatus('cancelled')
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
      // SU-J12-2: Trigger explicit tree refresh on Accept. The
      // NodeTree's useNodesRealtime subscription is the primary refresh
      // path, but Mars-drive 2026-05-09 reproduced a delay where the
      // nodes broadcast doesn't reach the client promptly (cause TBD).
      // Calling onMutated() guarantees the tree refetches regardless.
      if (action === 'accept') {
        onMutated?.()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────
  const padding = 'var(--space-5)'

  // Phase 5c — streaming synthesise surface takes precedence over the
  // generic ActiveState while the SSE is open. Once `agent_job_complete`
  // fires, streamingStatus transitions back to 'idle' and the realtime
  // hook's activeJob takes over rendering as CompleteState.
  if (streamingStatus === 'connecting' || streamingStatus === 'streaming') {
    return (
      <StreamingState
        text={streamingText}
        status={streamingStatus}
        onCancel={cancelStreamingSynthesise}
      />
    )
  }

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

  if (activeJob && activeJob.status === 'failed') {
    return (
      <FailedState
        job={activeJob}
        busy={busy}
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
    <div data-testid="agent-tab" style={{ padding, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div>
        <Label>Profile</Label>
        <select
          data-testid="agent-profile-select"
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
          data-testid="agent-instruction-input"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="e.g. focus on character interiority"
          rows={3}
          disabled={busy}
          style={textareaStyle}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {expandCapable && (
          <OpButton
            op="expand"
            label="Expand"
            icon="⚡"
            disabled={busy}
            onClick={() => trigger('expand')}
            testId="agent-expand-btn"
          />
        )}
        {generateContextCapable && (
          <OpButton
            op="generate_context"
            label="Generate context"
            icon="◆"
            disabled={busy}
            onClick={() => trigger('generate_context')}
            testId="agent-generate-context-btn"
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
            testId="agent-synthesise-btn"
          />
        )}
        {/* Critique button — V1.x; rendered disabled per Component Spec §5.9 layout */}
        <OpButton op="expand" label="Critique" icon="🔍" disabled tooltip="Critique is V1.x — coming soon" onClick={() => {}} testId="agent-critique-btn" />
      </div>

      {refineCapable && (
        <div
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-3)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: '4px',
            background: 'var(--color-bg-base)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <Label>Refine</Label>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', fontFamily: 'var(--font-inter), Inter, sans-serif' }}>
              Target field:
            </span>
            <select
              data-testid="agent-refine-field-select"
              value={refineField}
              onChange={(e) => setRefineField(e.target.value as 'summary' | 'prose' | 'notes')}
              disabled={busy}
              style={{ ...selectStyle, width: 'auto', flex: 1 }}
            >
              <option value="summary">summary</option>
              <option value="prose" disabled={!isLeaf}>prose {isLeaf ? '' : '(leaf-only)'}</option>
              <option value="notes">notes</option>
            </select>
          </div>
          <textarea
            data-testid="agent-refine-instruction-input"
            value={refinementInstruction}
            onChange={(e) => setRefinementInstruction(e.target.value)}
            placeholder="What should the refine change?"
            rows={2}
            disabled={busy}
            style={textareaStyle}
          />
          <OpButton
            op="refine"
            label="Refine"
            icon="✏"
            disabled={busy || !refinementInstruction.trim()}
            onClick={() => trigger('refine')}
            testId="agent-refine-btn"
          />
        </div>
      )}
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
  testId,
}: {
  op: string
  label: string
  icon: string
  disabled?: boolean
  fullWidth?: boolean
  tooltip?: string
  onClick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
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
  // Indeterminate progress bar — a sliding stripe animated via CSS @keyframes
  // (defined in styles/tokens.css). LLM operations don't expose true progress
  // (we get tokens AFTER the call completes, not during), so a percentage-
  // based bar would always be misleading. The indeterminate sweep
  // communicates "running, no ETA" honestly. Token counts are NOT shown
  // during running because Anthropic only reports them post-completion;
  // they appear in the COMPLETE state instead.
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
          }}
        >
          {/* SU-J12-8: drop the trailing " · " separator when model_id
              is null (job hasn't reached the LLM yet). */}
          {[job.operation_type, job.status, job.model_id].filter(Boolean).join(' · ')}
        </div>
      </div>
      <button
        data-testid="agent-stop-btn"
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
  const tokensIn = job.tokens_input ?? 0
  const tokensOut = job.tokens_output ?? 0
  const tokensTotal = tokensIn + tokensOut
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
          {job.operation_type} complete · {cost}
        </div>
        <div
          style={{
            marginBottom: 'var(--space-2)',
            fontSize: '10px',
            fontWeight: 300,
            color: 'var(--color-text-muted)',
          }}
        >
          tokens: {tokensIn.toLocaleString()} in · {tokensOut.toLocaleString()} out · {tokensTotal.toLocaleString()} total
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
          data-testid="agent-accept-btn"
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
          data-testid="agent-dismiss-btn"
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

/**
 * FailedState — surface error_message from a failed agent_job.
 *
 * SU-J12-3 (Mars-drive 2026-05-09): without an explicit failed branch the
 * component fell through to IDLE, hiding the error from the author.
 * Authors then re-ran the same operation, hit the same failure, and lost
 * faith in the surface. Now we render the error_message verbatim with a
 * Dismiss button that transitions the job to status='dismissed' so the
 * IDLE panel returns and the next attempt can be made.
 */
function FailedState({
  job,
  onDismiss,
  busy,
}: {
  job: AgentJob
  onDismiss: () => void
  busy: boolean
}) {
  const message = job.error_message?.trim() || 'The agent operation failed without a specific error message.'
  return (
    <div
      data-testid="agent-failed-state"
      style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}
    >
      <div
        style={{
          padding: 'var(--space-3)',
          border: '1px solid var(--color-error)',
          borderRadius: '4px',
          background: 'var(--color-bg-base)',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: '12px',
          color: 'var(--color-text-secondary)',
          maxHeight: '300px',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            fontWeight: 500,
            marginBottom: 'var(--space-2)',
            color: 'var(--color-error)',
          }}
        >
          {job.operation_type} failed
        </div>
        <div
          style={{
            marginBottom: 'var(--space-2)',
            fontSize: '10px',
            fontWeight: 300,
            color: 'var(--color-text-muted)',
          }}
        >
          {job.model_id ?? ''}
        </div>
        <pre
          data-testid="agent-failed-message"
          style={{
            fontFamily: 'var(--font-mono), Geist Mono, monospace',
            fontSize: '11px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
          }}
        >
          {message}
        </pre>
      </div>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          data-testid="agent-dismiss-btn"
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

/**
 * Phase 5c streaming synthesise surface — typewriter view of the
 * accumulating prose, with a small "streaming…" indicator and Cancel
 * button. The typeface follows the ProseEditor's Lora to make the
 * end-of-stream transition to Tiptap rendering visually seamless
 * (Component Spec v2.9 §5.9 streaming subsection).
 */
function StreamingState({
  text,
  status,
  onCancel,
}: {
  text: string
  status: 'connecting' | 'streaming'
  onCancel: () => void
}) {
  return (
    <div
      style={{
        padding: 'var(--space-5)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        height: '100%',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '10px',
            fontWeight: 300,
            color: 'var(--color-text-muted)',
          }}
        >
          {status === 'connecting' ? 'connecting…' : 'streaming…'}
        </span>
        <button
          data-testid="agent-cancel-btn"
          onClick={onCancel}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--color-error)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
            fontSize: '11px',
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>

      <div
        data-testid="synthesise-streaming-surface"
        style={{
          flex: 1,
          padding: 'var(--space-4)',
          background: 'var(--color-bg-base)',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: '4px',
          fontFamily: 'var(--font-lora), Lora, serif',
          fontSize: '15px',
          fontWeight: 400,
          lineHeight: 1.7,
          color: 'var(--color-text-primary)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          overflowY: 'auto',
          maxHeight: '60vh',
        }}
      >
        {/*
          No cursor element rendered — Inviolable #2 reserves verdigris for
          the nine enumerated uses, and "prose cursor" specifically scopes
          to ProseEditor and FocusMode. The streaming text arrival itself
          provides the typewriter feel; a separate cursor would be either a
          tenth verdigris use (forbidden) or a colour off-brand for a prose
          surface. Component Spec v2.9 §5.9 streaming subsection records
          this decision.
        */}
        {text}
      </div>
    </div>
  )
}

/**
 * SU-J12-7 (Mars-drive 2026-05-09): models commonly return names with
 * their own ordinal prefix (e.g. "1. Red Genesis", "2) Inheritance",
 * "Chapter 3: The Bracket"). describeResult adds its own "${i+1}. "
 * before the name, producing visible doubles like "1. 1. Red Genesis".
 * Strip any leading ordinal prefix from the model-provided name before
 * the display layer adds its own.
 */
function stripOrdinalPrefix(name: string): string {
  return name.replace(/^\s*\d+\s*[.)\-:]\s*/, '').trim()
}

function describeResult(job: AgentJob): string {
  if (job.result_child_nodes && Array.isArray(job.result_child_nodes)) {
    const items = job.result_child_nodes as Array<{ name?: string; short_description?: string }>
    return items
      .map((c, i) => `${i + 1}. ${stripOrdinalPrefix(c.name ?? '(unnamed)') || '(unnamed)'}\n   ${c.short_description ?? ''}`)
      .join('\n\n')
  }
  if (job.result_prose) return job.result_prose.slice(0, 600) + (job.result_prose.length > 600 ? '…' : '')
  if (job.result_summary) return job.result_summary.slice(0, 600) + (job.result_summary.length > 600 ? '…' : '')
  if (job.result_notes) return job.result_notes
  if (job.result_metadata) return JSON.stringify(job.result_metadata, null, 2)
  return '(no result)'
}
