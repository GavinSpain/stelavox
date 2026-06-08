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

import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useNode } from '@/lib/queries/useNode'
import { nodeKeys } from '@/lib/queries/keys'
import { DetailPanelSkeleton } from '@/components/feedback/skeletons/DetailPanelSkeleton'
import { QueryErrorFallback } from '@/components/feedback/QueryErrorFallback'
import { TabStrip } from './TabStrip'
import { NodeStatusBadge } from '@/components/tree/NodeStatusBadge'
import { LayerLabel, type LayerKind } from '@/components/tree/LayerLabel'
import { useActiveJobForNode } from '@/lib/hooks/useAgentJobsRealtime'
import { SummaryEditor } from './SummaryEditor'
import { ProseEditor } from './ProseEditor'
import { StructureOverview } from './StructureOverview'
import { DetailPaneCrumb } from './DetailPaneCrumb'
import { NotesEditor } from './NotesEditor'
import { FocusModeButton } from './FocusModeButton'
import { ProseSettingsMenu } from './ProseSettingsMenu'
import { ConflictBanner } from './ConflictBanner'
import { HistoryTab } from './HistoryTab'
import { MetadataForm } from './MetadataForm'
import { ContextTab } from './ContextTab'
import { AgentTab } from './AgentTab'
import { CommentThread } from './CommentThread'
import { AgentJobHistory } from './AgentJobHistory'
import { createClient } from '@/lib/supabase/client'
import { useNodeRealtime } from '@/lib/hooks/useNodeRealtime'
// useCallback already imported above for B.3b wiring.
// Phase 8.5b B.7 — FocusMode dynamic-imported so the typewriter
// container + sentence-focus state machine + full-screen Portal mount
// only load when the user actually enters Focus Mode. `ssr: false` is
// correct because Focus Mode is interactive-only and uses
// `document.body` createPortal which is not server-renderable. Static
// import is replaced via next/dynamic; FocusModeProps shape is
// unchanged.
import nextDynamic from 'next/dynamic'
const FocusMode = nextDynamic(
  () => import('@/components/focus/FocusMode').then((m) => m.FocusMode),
  { ssr: false },
)
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
  // Phase 8.01.B T-1.1 — exposed so FocusMode can render the bracketed
  // leaf-label in the breadcrumb (Component Spec v2.21 §6.2 / §18.1).
  // The API already returns this column (lib/data/nodes.ts NODE_SELECT).
  order: number
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
  /**
   * Phase 8.01.E T-5 — optional navigation callback used by the new
   * non-leaf "structure overview" children panel. When a child row in
   * the panel is clicked, the caller (typically the document client)
   * updates `selectedNodeId` so the tree + detail panel reflect the
   * new selection. Omit to disable child-row navigation (the children
   * panel still renders but rows become no-ops).
   */
  onSelectNode?: (nodeId: string) => void
}

// Phase 6 D7 reduced the status enum from 4 values to 2.
// 'in_review' and 'locked' were vestigial; the DB CHECK rejects them.
const STATUS_VALUES = ['draft', 'approved'] as const

// Phase 8.01 round 3 — V1 layer-stack canonical structural types.
const STRUCTURAL_LAYER_KINDS: ReadonlySet<string> = new Set<LayerKind>([
  'series', 'book', 'act', 'chapter', 'scene', 'beat',
])

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

export function NodeDetailPanel({ nodeId, refreshKey, onMutated, onClose, onSelectNode }: NodeDetailPanelProps) {
  const queryClient = useQueryClient()
  // Phase 8.5b B.3b — useNode is the cache-backed read for /api/nodes/[id].
  // Local `node` state still drives the UI (post-PATCH mutations write to
  // the local state for snappy feedback + setQueryData to keep the cache
  // in sync). The hook is the source of truth for the FIRST load and for
  // Realtime-patcher updates.
  const nodeQuery = useNode(nodeId)
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
  // nodes.prose). Pre-B.3b this bumped a local tick; now it invalidates
  // the cache key so useNode refetches and the local `node` state syncs
  // via the useEffect below. The NodesPatcherMount at app shell also
  // patches the cache for non-prose UPDATEs without a fetch.
  const triggerRefetch = useCallback(() => {
    setRealtimeTick((t) => t + 1)
    if (nodeId) void queryClient.invalidateQueries({ queryKey: nodeKeys.single(nodeId) })
  }, [nodeId, queryClient])
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

  // Phase 8.5b B.3b — useNode is the cache-backed fetch. This effect
  // syncs the hook's data to local `node` state and loads the editor
  // store. The flushPending call still runs first on every nodeId
  // change to commit the prior node's edits before the new node lands.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await flushPending()
      if (cancelled) return
      if (nodeQuery.error) {
        setError(nodeQuery.error.message ?? 'fetch_failed')
        return
      }
      if (!nodeQuery.data) {
        // Still loading or zero-row; leave error null until query lands.
        return
      }
      setError(null)
      const fetched = nodeQuery.data as unknown as NodeRecord
      setNode(fetched)
      loadNode({
        id: fetched.id,
        version: fetched.version,
        content_revision: (fetched as { content_revision?: number }).content_revision,
        summary: fetched.summary,
        prose: fetched.prose,
        notes: fetched.notes,
        metadata: fetched.metadata,
      })
    })()
    return () => { cancelled = true }
  }, [nodeId, refreshKey, realtimeTick, flushPending, loadNode, nodeQuery.data, nodeQuery.error])

  // refreshKey-driven invalidation — keeps parity with pre-B.3 behaviour.
  useEffect(() => {
    if (!nodeId || refreshKey === undefined) return
    void queryClient.invalidateQueries({ queryKey: nodeKeys.single(nodeId) })
  }, [refreshKey, nodeId, queryClient])

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
    let r: Response
    try {
      r = await fetch(`/api/nodes/${nodeId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
    } catch (e) {
      // F-220 (round-3 audit B3.6): network failure was silent. Surface
      // to the dev console at minimum. UI toast is Phase 7 polish per
      // docs/architecture/error-handling-conventions.md (this component
      // doesn't currently consume useToast).
      console.error('[NodeDetailPanel] rename network failure', e)
      return
    }
    if (r.ok) {
      const body = await r.json()
      const updated = body.node as NodeRecord
      setNode(updated)
      // Phase 8.5b B.3b — keep the cache in sync so any other consumer
      // (other tabs in the same browser via Realtime; future cross-
      // mounted siblings) reads the new name without a refetch.
      queryClient.setQueryData(nodeKeys.single(nodeId), updated)
      onMutated?.()
      return
    }
    // F-220: non-OK was silent. Surface to the dev console.
    console.error('[NodeDetailPanel] rename non-OK', r.status)
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
      const updated = body.node as NodeRecord
      setNode(updated)
      // Phase 8.5b B.3b — cache sync (same rationale as submitName).
      queryClient.setQueryData(nodeKeys.single(nodeId), updated)
      onMutated?.()
    }
  }

  if (error) {
    return (
      <QueryErrorFallback
        error={nodeQuery.error ?? new Error(error)}
        onRetry={() => {
          if (nodeId) void queryClient.invalidateQueries({ queryKey: nodeKeys.single(nodeId) })
        }}
        label="Could not load node"
      />
    )
  }

  if (!node) {
    return <DetailPanelSkeleton />
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
        {/* Phase 8.01.E T-7 — Detail-pane crumb above the title. Closes
            the 8.01.A T-7 deferral. Hidden when onSelectNode is
            unavailable AND ancestor chain would be empty + node isn't
            a context node — the DetailPaneCrumb internally returns
            null in that case. */}
        <DetailPaneCrumb
          node={{
            id: node.id,
            node_type: node.node_type,
            node_category: node.node_category,
            order: node.order,
          }}
          onSelectAncestor={(ancestorId) => onSelectNode?.(ancestorId)}
        />
        {/* Phase 8.01 wireframe-alignment round 3 — title row matches
            wireframe 04_detail_panes_v1_iter1 .dp-title-row: bracketed
            monospace layer chip + 18px/600 title. */}
        <div
          data-testid="detail-title-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
          }}
        >
          {node.node_category === 'structural' && STRUCTURAL_LAYER_KINDS.has(node.node_type) && (
            <LayerLabel
              layer={node.node_type as LayerKind}
              position={node.order}
              style={{ flexShrink: 0 }}
            />
          )}
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
                fontSize: 18,
                fontWeight: 600,
                background: 'var(--color-bg-base)',
                color: 'var(--color-text-primary)',
                border: '1px solid var(--color-border-default)',
                borderRadius: 4,
                padding: '4px 8px',
                letterSpacing: '-0.005em',
              }}
            />
          ) : (
            <h2
              data-testid="node-name-heading"
              onClick={() => setEditing(true)}
              style={{
                flex: 1,
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                margin: 0,
                cursor: 'text',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                letterSpacing: '-0.005em',
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
          {/* Phase 8.2 — close affordance removed. Selection changes
              by clicking another tree row; there is no "deselected"
              state on a document page. */}
        </div>

        {/* Phase 8.01 wireframe-alignment round 3 — meta row matches
            wireframe .dp-meta: animated status pip + node-type label
            in monospace + status pill. */}
        <DetailMetaRow
          nodeId={node.id}
          nodeType={node.node_type}
          status={node.status}
          onStatusChange={changeStatus}
        />
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
                    {/* Phase 8.8 — ProseSettingsMenu sits beside the
                        FocusModeButton in the same chrome row. Edit-Mode
                        defaults: both toggles off (Component Spec §6.4 /
                        §6.5). */}
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <FocusModeButton onClick={() => setFocusMode(true)} />
                      <ProseSettingsMenu variant="edit" />
                    </div>
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

              {/* Phase 8.01.E T-5 — non-leaf "structure overview" children
                  panel. Replaces the prose canvas (which is leaf-only above)
                  with a read-only listing of immediate children. Only mounts
                  for STRUCTURAL non-leaves; context non-leaves keep the
                  existing MetadataForm-driven shape below. */}
              {!node.is_leaf && node.node_category === 'structural' && (
                <StructureOverview
                  nodeId={node.id}
                  onChildSelect={(childId) => onSelectNode?.(childId)}
                />
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

// ────────────────────────────────────────────────────────────────────
// Phase 8.01 wireframe-alignment round 3 — Detail meta row + status pip.

function DetailMetaRow({
  nodeId,
  nodeType,
  status,
  onStatusChange,
}: {
  nodeId: string
  nodeType: string
  status: string
  onStatusChange: (s: string) => void
}) {
  return (
    <div
      data-testid="detail-meta-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginTop: 8,
        fontSize: 11.5,
        color: 'var(--color-text-muted)',
        flexWrap: 'wrap',
      }}
    >
      <DetailStatusPip nodeId={nodeId} status={status} />
      <span
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          letterSpacing: '0.04em',
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
        }}
      >
        {nodeType}
      </span>
      <span aria-hidden style={{ color: 'var(--color-text-disabled)' }}>·</span>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <NodeStatusBadge status={status} />
        <select
          data-testid="status-select"
          aria-label="Status"
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-secondary)',
            fontSize: 11.5,
            cursor: 'pointer',
          }}
        >
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </label>
    </div>
  )
}

/** Animated status pip per wireframe 04_detail_panes_v1_iter1 .status-pip:
 *  running blue + pulse + glow, review amber + glow, complete verdigris. */
function DetailStatusPip({ nodeId, status }: { nodeId: string; status: string }) {
  const job = useActiveJobForNode(nodeId)
  const jobStatus = job?.status
  const variant: 'running' | 'review' | 'complete' | 'idle' =
    jobStatus === 'running' || jobStatus === 'pending'
      ? 'running'
      : jobStatus === 'completed'
      ? 'review'
      : status === 'approved'
      ? 'complete'
      : 'idle'

  const styles: Record<typeof variant, React.CSSProperties> = {
    running: {
      background: 'var(--color-info)',
      boxShadow: '0 0 5px rgba(77,143,214,0.55)',
      animation: 'detail-pip-pulse 2s ease-in-out infinite',
    },
    review: {
      background: 'var(--color-status-review)',
      boxShadow: '0 0 4px rgba(224,144,64,0.4)',
    },
    complete: {
      background: 'var(--color-accent-hover)',
    },
    idle: {
      background: 'var(--color-border-strong)',
    },
  }

  return (
    <>
      <style>{`
        @keyframes detail-pip-pulse {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
      `}</style>
      <span
        data-testid="detail-status-pip"
        data-variant={variant}
        aria-label={`status: ${variant}`}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          ...styles[variant],
        }}
      />
    </>
  )
}
