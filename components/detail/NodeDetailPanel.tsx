'use client'

// Spec: stelavox_component_specification_v2_0.md §5.1 (NodeDetailPanel)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.6 T-6.1..T-6.3
//
// Phase 2 detail panel. Header: editable name + status dropdown.
// TabStrip with five placeholder tabs (Content / Comments / Agent /
// History / Context). Each tab body shows a phase-banner — the real
// editors land in Phase 3 (Content, History), agents in Phase 5
// (Agent, Comments), context library in Phase 4 (Context).
//
// Fetches the node via GET /api/nodes/[id] on mount and on
// `refreshKey` change (so external mutations can trigger a re-fetch).
// PATCHes via /api/nodes/[id] for rename and status. Calls
// onMutated() on success so the parent can refresh the tree.
//
// Inviolable #2: `--color-accent` MUST NOT appear in this file.
// The status badge dot inside the dropdown reuses NodeStatusBadge,
// which is the only sanctioned place for verdigris in the tree
// surface (uses #4 and #5).

import { useEffect, useState } from 'react'
import { TabStrip } from './TabStrip'
import { NodeStatusBadge } from '@/components/tree/NodeStatusBadge'

interface NodeRecord {
  id: string
  name: string | null
  status: string
  node_type: string
  parent_id: string | null
  document_id: string | null
  depth: number
  layer_index: number | null
  short_description: string | null
  word_count_target: number | null
  word_count_actual: number | null
  agent_instruction: string | null
  version: number
}

interface NodeDetailPanelProps {
  nodeId: string
  refreshKey?: number
  onMutated?: () => void
  onClose?: () => void
}

const STATUS_VALUES = ['draft', 'in_review', 'approved', 'locked'] as const

const TABS = [
  { id: 'content',  label: 'Content'  },
  { id: 'comments', label: 'Comments' },
  { id: 'agent',    label: 'Agent'    },
  { id: 'history',  label: 'History'  },
  { id: 'context',  label: 'Context'  },
] as const

const TAB_PLACEHOLDERS: Record<string, string> = {
  content:  'Summary, prose, and notes editors arrive in Phase 3.',
  comments: 'Comments arrive in Phase 5 with the agent system.',
  agent:    'Agent jobs arrive in Phase 5.',
  history:  'Version history arrives in Phase 3 alongside the editors.',
  context:  'Context links arrive in Phase 4 with the context library.',
}

export function NodeDetailPanel({ nodeId, refreshKey, onMutated, onClose }: NodeDetailPanelProps) {
  const [node, setNode]     = useState<NodeRecord | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('content')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/nodes/${nodeId}`, { headers: { 'content-type': 'application/json' } })
      .then(async r => {
        const body = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setError(typeof body?.error === 'string' ? body.error : 'fetch_failed')
          return
        }
        setError(null)
        setNode(body.node as NodeRecord)
      })
      .catch(() => { if (!cancelled) setError('fetch_failed') })
    return () => { cancelled = true }
  }, [nodeId, refreshKey])

  async function submitName(next: string) {
    if (!node) return
    const trimmed = next.trim()
    if (!trimmed || trimmed === node.name) { setEditing(false); return }
    setEditing(false)
    const r = await fetch(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    })
    if (r.ok) {
      const body = await r.json()
      setNode(body.node as NodeRecord)
      onMutated?.()
    }
  }

  async function changeStatus(status: string) {
    if (!node) return
    const r = await fetch(`/api/nodes/${nodeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    if (r.ok) {
      const body = await r.json()
      setNode(body.node as NodeRecord)
      onMutated?.()
    }
  }

  if (error) {
    return (
      <div style={{ padding: 'var(--space-5)', color: 'var(--color-text-muted)' }}>
        Could not load node.
      </div>
    )
  }

  if (!node) {
    return (
      <div style={{ padding: 'var(--space-5)', color: 'var(--color-text-muted)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-surface)',
      }}
    >
      {/* Header — title + status + tabs */}
      <div style={{ padding: 'var(--space-4) var(--space-5)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          {editing ? (
            <input
              autoFocus
              defaultValue={node.name ?? ''}
              onBlur={(e) => submitName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitName(e.currentTarget.value)
                else if (e.key === 'Escape') setEditing(false)
              }}
              aria-label="Rename node"
              style={{
                flex: 1,
                fontSize: '14px',
                fontWeight: 600,
                background: 'var(--color-bg-base)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-default)',
                borderRadius: '4px',
                padding: '4px 8px',
              }}
            />
          ) : (
            <h2
              data-testid="node-name-heading"
              onClick={() => setEditing(true)}
              style={{
                flex: 1,
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                margin: 0,
                cursor: 'text',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {node.name ?? '(untitled)'}
            </h2>
          )}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close detail panel"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                fontSize: '16px',
                padding: '4px',
              }}
            >
              ×
            </button>
          )}
        </div>

        {/* Type + status pill */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {node.node_type}
          </span>
          <span style={{ color: 'var(--color-text-muted)' }}>·</span>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            <NodeStatusBadge status={node.status} />
            <select
              data-testid="status-select"
              value={node.status}
              onChange={(e) => changeStatus(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-secondary)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
              }}
            >
              {STATUS_VALUES.map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />

      <div
        style={{
          flex: 1,
          padding: 'var(--space-5)',
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-sm)',
          overflow: 'auto',
        }}
      >
        {TAB_PLACEHOLDERS[activeTab]}
      </div>
    </div>
  )
}
