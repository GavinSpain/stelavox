'use client'

// Spec: stelavox_component_specification_v2_1.md §5.1 (NodeDetailPanel),
//                                              §5.2 (TabStrip),
//                                              §5.13 (NotesEditor)
//       stelavox_phase3_build_checklist_v1_0.md §3.5 T-5.1 / T-5.2
//       stelavox_phase3_api_contract_v1_0.md §2.11 (editor invariants)
//
// Phase 3: Content tab now hosts SummaryEditor → ProseEditor (edit mode) →
// FocusModeButton → NotesEditor. All three pull values from editor-store
// and route onChange → setField. ConflictBanner mounts above the editors
// and surfaces 409/423 from the autosave loop.
//
// Cross-node flush (T-4.9 alignment): the useEffect awaits flushPending()
// for the previously-active node before fetching the new node, so node
// switches never lose pending edits. Tree-level flush in NodeTree row
// click is the earlier safety net; this is the panel-level guarantee.
//
// Inviolable #2: --color-accent MUST NOT appear in this file. NodeStatusBadge
// owns the verdigris uses #4 (agent-complete) / #5 (approved) for the tree
// surface; the prose-side verdigris uses (#3 cursor, #6 word count, #7 accept)
// are inside ProseEditor / WordCount / AgentTab, not here.

import { useEffect, useState } from 'react'
import { TabStrip } from './TabStrip'
import { NodeStatusBadge } from '@/components/tree/NodeStatusBadge'
import { SummaryEditor } from './SummaryEditor'
import { ProseEditor } from './ProseEditor'
import { NotesEditor } from './NotesEditor'
import { FocusModeButton } from './FocusModeButton'
import { ConflictBanner } from './ConflictBanner'
import { HistoryTab } from './HistoryTab'
import { MetadataForm } from './MetadataForm'
import { ContextTab } from './ContextTab'
import { AgentTab } from './AgentTab'
import { CommentThread } from './CommentThread'
import { AgentJobHistory } from './AgentJobHistory'
import { createClient } from '@/lib/supabase/client'
import { useNodeRealtime } from '@/lib/hooks/useNodeRealtime'
import { useCallback } from 'react'
import { FocusMode } from '@/components/focus/FocusMode'
import { useEditorStore } from '@/lib/stores/editor-store'
import { useSidebarProject } from '@/components/layout/AppShell'
import { DeleteContextNodeModal } from '@/components/context/DeleteContextNodeModal'
import { Trash2 } from 'lucide-react'

interface NodeRecord {
  id: string
  name: string | null
  status: string
  node_type: string
  // Phase 4: node_category and scope are surfaced so the detail panel can
  // render different bodies for context nodes (no ProseEditor, no Focus
  // Mode entry, MetadataForm renders the context-type schema).
  node_category: 'structural' | 'context'
  scope: 'project' | 'document' | null
  project_id: string
  parent_id: string | null
  document_id: string | null
  depth: number
  layer_index: number | null
  short_description: string | null
  word_count_target: number | null
  word_count_actual: number | null
  agent_instruction: string | null
  version: number
  summary: string | null
  prose: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
  // Phase 3 v1.1 (API Contract §2.12): server-derived; gates the prose group
  // (ProseEditor, FocusModeButton, WordCount) and the ⌘Return entry handler.
  // Never inferred from child count — see TA v1.6 H-15.
  is_leaf: boolean
}

interface NodeDetailPanelProps {
  nodeId: string
  refreshKey?: number
  onMutated?: () => void
  onClose?: () => void
}

const STATUS_VALUES = ['draft', 'in_review', 'approved', 'locked'] as const

// Order per Component Spec §5.1 + Build Checklist T-5.2:
// Content, Agent, Comments, History (versions), Jobs, Context.
// Notes is folded into Content.
// Jobs tab (Phase 5) is document-wide agent-job history per Build Checklist T-14.1.
const TABS = [
  { id: 'content',  label: 'Content'  },
  { id: 'agent',    label: 'Agent'    },
  { id: 'comments', label: 'Comments' },
  { id: 'history',  label: 'History'  },
  { id: 'jobs',     label: 'Jobs'     },
  { id: 'context',  label: 'Context'  },
] as const

export function NodeDetailPanel({ nodeId, refreshKey, onMutated, onClose }: NodeDetailPanelProps) {
  const [node, setNode] = useState<NodeRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('content')
  const [focusMode, setFocusMode] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [realtimeTick, setRealtimeTick] = useState(0)
  const { state: sidebarState, bumpRefresh } = useSidebarProject()

  // Phase 5 (SU-31 proper fix): refresh the open node when its row in the
  // nodes table changes (e.g. after an agent Accept commits new prose to
  // nodes.prose). Bumps a tick that the existing fetch useEffect deps on.
  // The fetch flushes pending local edits first, so this is safe even
  // mid-typing.
  const triggerRefetch = useCallback(() => setRealtimeTick((t) => t + 1), [])
  useNodeRealtime(nodeId, triggerRefetch)

  // Load the current user ID once for the CommentThread (author check).
  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setCurrentUserId(user?.id ?? null)
    })()
  }, [])

  // Pull editor state from the store. The editors stay presentation-only —
  // the store owns the debounce, single-flight, and shadow.
  const summary  = useEditorStore(s => s.summary)
  const prose    = useEditorStore(s => s.prose)
  const notes    = useEditorStore(s => s.notes)
  const setField = useEditorStore(s => s.setField)
  const lockedReason = useEditorStore(s => s.lockedReason)
  const loadNode     = useEditorStore(s => s.loadNode)
  const flushPending = useEditorStore(s => s.flushPending)

  // Phase 3 (T-4.9): on every nodeId change, flush the prior node's pending
  // edits BEFORE fetching the new node. Then load the new node into the
  // store. The cleanup is fire-and-forget on unmount (best-effort).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await flushPending()
      if (cancelled) return

      const r = await fetch(`/api/nodes/${nodeId}`, {
        headers: { 'content-type': 'application/json' },
      })
      const body = await r.json().catch(() => null)
      if (cancelled) return
      if (!r.ok || !body?.node) {
        setError(typeof body?.error === 'string' ? body.error : 'fetch_failed')
        return
      }
      setError(null)
      const fetched = body.node as NodeRecord
      setNode(fetched)
      loadNode({
        id: fetched.id,
        version: fetched.version,
        // SU-J14-15 (Step 2 multi-tab drive 2026-05-10): the editor-store
        // anchors autosave concurrency on content_revision (J14-1).
        // Forgetting to pass it here meant the store fell back to
        // version, which only bumps on agent Accept — every autosave then
        // sent a stale expected_content_revision and 409'd.
        content_revision: (fetched as { content_revision?: number }).content_revision,
        summary: fetched.summary,
        prose: fetched.prose,
        notes: fetched.notes,
        metadata: fetched.metadata,
      })
    })()
    return () => { cancelled = true }
  }, [nodeId, refreshKey, realtimeTick, flushPending, loadNode])

  // T-6.8: ⌘Return in Edit Mode prose enters Focus Mode. capture:true so
  // we run before Tiptap's hard-break binding (HardBreak extension binds
  // Mod-Enter in v3); preventDefault + stopPropagation block it.
  //
  // v1.1 (Component Spec v2.2 §5.1): leaf-gated. The handler only registers
  // when node.is_leaf === true. Without this, the DOM-presence check below
  // would still no-op on non-leaves (no prose-edit element exists), but the
  // explicit gate makes the rule visible at the call site.
  useEffect(() => {
    if (!node?.is_leaf) return
    function onKeydown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key !== 'Enter') return
      const proseEl = document.querySelector('[data-editor="prose"][data-mode="edit"] .tiptap')
      if (proseEl && proseEl.contains(document.activeElement)) {
        e.preventDefault()
        e.stopPropagation()
        setFocusMode(true)
      }
    }
    window.addEventListener('keydown', onKeydown, { capture: true })
    return () => window.removeEventListener('keydown', onKeydown, { capture: true } as EventListenerOptions)
  }, [node?.is_leaf])

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

  const isReadOnly = !!lockedReason

  return (
    <>
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
          {/* Phase 4: delete button for context nodes only — uses
              DeleteContextNodeModal which fetches back-links and
              issues ?force=true. Structural deletes happen from the
              tree's right-click menu (Phase 2). */}
          {node.node_category === 'context' && (
            <button
              type="button"
              onClick={() => setDeleteModalOpen(true)}
              aria-label="Delete context node"
              title="Delete"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                cursor: 'pointer',
                padding: '4px',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <Trash2 size={14} />
            </button>
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
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {activeTab === 'content' && (
          <>
            <ConflictBanner />
            <div
              style={{
                padding: 'var(--space-4) var(--space-5)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-4)',
                flex: 1,
              }}
            >
              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontFamily: 'var(--font-inter), Inter, sans-serif',
                    fontWeight: 500,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Summary
                </label>
                <SummaryEditor
                  value={summary}
                  onChange={(v) => setField('summary', v)}
                  readOnly={isReadOnly}
                />
              </div>

              {/* Prose group — leaves only (Component Spec v2.2 §5.1 / API
                  Contract v1.1 §2.12 / TA v1.6 H-15). ProseEditor mounts only
                  when node.is_leaf === true; on a non-leaf (Book/Act/Chapter/
                  Scene), the prose surface, the FocusModeButton, and WordCount
                  (rendered inside ProseEditor) are all suppressed. */}
              {node.is_leaf && (
                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 'var(--space-2)',
                    }}
                  >
                    <label
                      style={{
                        fontSize: '11px',
                        fontFamily: 'var(--font-inter), Inter, sans-serif',
                        fontWeight: 500,
                        color: 'var(--color-text-muted)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                      }}
                    >
                      Prose
                    </label>
                    <FocusModeButton onClick={() => setFocusMode(true)} />
                  </div>
                  <ProseEditor
                    mode="edit"
                    value={prose}
                    onChange={(v) => setField('prose', v)}
                    readOnly={isReadOnly}
                    wordTarget={node.word_count_target}
                  />
                </div>
              )}

              <MetadataForm
                nodeType={node.node_type}
                nodeCategory={node.node_category}
                readOnly={isReadOnly}
              />

              <div>
                <label
                  style={{
                    display: 'block',
                    fontSize: '11px',
                    fontFamily: 'var(--font-inter), Inter, sans-serif',
                    fontWeight: 500,
                    color: 'var(--color-text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Notes
                </label>
                <NotesEditor
                  value={notes}
                  onChange={(v) => setField('notes', v)}
                  readOnly={isReadOnly}
                />
              </div>
            </div>
          </>
        )}

        {activeTab === 'history' && (
          <HistoryTab nodeId={nodeId} />
        )}

        {activeTab === 'context' && (
          <ContextTab
            nodeId={nodeId}
            nodeCategory={node.node_category}
            projectId={node.project_id ?? sidebarState.projectId ?? ''}
            documentId={node.document_id ?? sidebarState.documentId}
          />
        )}

        {activeTab === 'agent' && (
          <AgentTab
            key={nodeId}
            nodeId={nodeId}
            nodeType={node.node_type}
            nodeCategory={node.node_category}
            isLeaf={node.is_leaf}
            onMutated={onMutated}
          />
        )}

        {activeTab === 'comments' && (
          <CommentThread nodeId={nodeId} currentUserId={currentUserId} />
        )}

        {activeTab === 'jobs' && node.document_id && (
          <AgentJobHistory documentId={node.document_id} />
        )}
      </div>
    </div>
    {focusMode && (
      <FocusMode
        node={node}
        onExit={() => setFocusMode(false)}
      />
    )}
    {deleteModalOpen && node.node_category === 'context' && (
      <DeleteContextNodeModal
        open
        contextNodeId={node.id}
        contextName={node.name}
        onClose={() => setDeleteModalOpen(false)}
        onDeleted={() => {
          setDeleteModalOpen(false)
          bumpRefresh()
          onClose?.()
        }}
      />
    )}
    </>
  )
}
