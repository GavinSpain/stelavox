'use client'

// Spec: stelavox_component_specification_v2_0.md §4.1 (NodeTree)
//       stelavox_phase2_api_contract_v1_0.md §3.2 (GET /api/documents/[id]/nodes)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.4 T-4.2
//
// react-arborist root for the node tree. Phase 2 §3.4 T-4.2 ships the
// data fetch + Tree composition with a STUB row renderer (StubRow at
// the bottom of this file). T-4.3 replaces StubRow with the full
// NodeRow component per Component Spec §4.2 (including hover actions,
// status badge, and the verdigris-#9 active-node left border).
//
// Data flow:
//   1. fetch GET /api/documents/[id]/nodes on mount (or documentId change)
//   2. transform the flat depth-first array into the parent-children
//      tree shape react-arborist expects via its childrenAccessor
//   3. pass to <Tree>, which renders virtualised rows with our renderer
//
// Height: the Tree component requires `height: number` (it uses
// react-window for virtualisation). Phase 2 §3.4 stub: use a fixed
// 600px height. T-4.x can swap to a measured parent height (or
// react-virtualized-auto-sizer) once the surrounding layout settles.

import { useCallback, useEffect, useState } from 'react'
import { Tree } from 'react-arborist'
import type { MoveHandler } from 'react-arborist'
import { NodeRow, NodeActionsProvider, type ArboristNode, type NodeData } from './NodeRow'
import { LayerDivider } from './LayerDivider'
import { NodeMoreMenu } from './NodeMoreMenu'
import { ToastProvider, useToast } from '@/components/feedback/Toast'
import { useNodesRealtime } from '@/lib/hooks/useNodesRealtime'

interface NodeTreeProps {
  documentId: string
  documentType?: 'novel' | 'short_story' | 'series'
  // Notified when a row is selected (clicked). Passed through to the
  // parent so it can populate AppShell's right slot with a detail panel.
  onSelect?: (nodeId: string | null) => void
  // External refresh trigger — when this prop changes, the tree refetches.
  // Used by NodeDetailPanel mutations to keep the tree in sync.
  refreshKey?: number
}

// Phase 2 stub: hardcoded layer labels for V1 templates. Spec calls
// for layer_stacks.layers[i].label, but Phase 2 has no GET endpoint
// for layer_stacks; a future polish pass replaces this with the real
// fetched labels.
//
// Note on rendering: Component Spec §4.7 implies per-section dividers
// inline in the tree, but react-arborist's virtualisation uses a
// fixed `rowHeight`, which makes per-row extra-height injection cause
// row overlap. Phase 2 stub renders these labels as a single
// horizontal legend at the top of the tree — a reasonable
// approximation that satisfies the Build Checklist's "rendering
// against a Novel template shows labels" acceptance. A future polish
// pass can switch to a custom `renderRow` that gives some rows extra
// vertical space for inline dividers.
const LAYER_LABELS: Record<string, readonly string[]> = {
  novel:       ['BOOK',   'ACTS',   'CHAPTERS', 'SCENES', 'BEATS'],
  short_story: ['STORY',  'SCENES', 'BEATS'],
  series:      ['SERIES', 'BOOKS',  'ACTS', 'CHAPTERS', 'SCENES', 'BEATS'],
}

// Lowercase node_type values for each layer index, parallel to
// LAYER_LABELS. Used by handleAddChild to derive the new child's
// node_type from the parent's layer_index. Same Phase 2 stub
// rationale: a future fetch of layer_stacks.layers replaces this.
const NODE_TYPES: Record<string, readonly string[]> = {
  novel:       ['book',   'act',   'chapter', 'scene', 'beat'],
  short_story: ['story',  'scene', 'beat'],
  series:      ['series', 'book',  'act', 'chapter', 'scene', 'beat'],
}

export function NodeTree(props: NodeTreeProps) {
  return (
    <ToastProvider>
      <NodeTreeInner {...props} />
    </ToastProvider>
  )
}

function NodeTreeInner({ documentId, documentType, onSelect, refreshKey }: NodeTreeProps) {
  const toast = useToast()
  const [data, setData]   = useState<ArboristNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [moreMenu, setMoreMenu] = useState<{ nodeId: string; anchor: HTMLElement; isRoot: boolean } | null>(null)

  // Phase 5 (SU-31 proper fix): subscribe to realtime nodes-table changes for
  // this document. Any INSERT/UPDATE/DELETE triggers a refetch (debounced 200ms
  // so a multi-row Accept transaction = one refetch). This replaces the
  // pattern of every mutation site calling bumpRefresh() — the tree now
  // self-syncs from the source of truth.
  const triggerRefetch = useCallback(() => setRefreshTick((t) => t + 1), [])
  useNodesRealtime(documentId, triggerRefetch)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/documents/${documentId}/nodes`, {
      headers: { 'content-type': 'application/json' },
    })
      .then(async r => {
        const body = await r.json()
        if (cancelled) return
        if (!r.ok) {
          setError(typeof body?.error === 'string' ? body.error : 'fetch_failed')
          return
        }
        setError(null)
        setData(buildTree(Array.isArray(body?.nodes) ? body.nodes : []))
      })
      .catch(() => {
        if (cancelled) return
        setError('fetch_failed')
      })
    return () => { cancelled = true }
  }, [documentId, refreshTick, refreshKey])

  function findInTree(nodes: ArboristNode[], id: string): ArboristNode | null {
    for (const n of nodes) {
      if (n.id === id) return n
      if (n.children) {
        const found = findInTree(n.children, id)
        if (found) return found
      }
    }
    return null
  }

  function handleMore(nodeId: string, anchor: HTMLElement) {
    if (!data) return
    const node = findInTree(data, nodeId)
    if (!node) return
    setMoreMenu({ nodeId, anchor, isRoot: node.data.parent_id === null })
  }

  async function handleAddChild(parentId: string) {
    if (!data || !documentType) return
    const parent = findInTree(data, parentId)
    if (!parent) return
    const types = NODE_TYPES[documentType]
    if (!types) return
    const childLayer = (parent.data.layer_index ?? 0) + 1
    const childType = types[childLayer]
    if (!childType) {
      window.alert('No deeper layer available beneath this node.')
      return
    }
    const name = window.prompt(`New ${childType} name:`)
    if (!name?.trim()) return
    const r = await fetch(`/api/documents/${documentId}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parent_id: parentId,
        node_type: childType,
        name: name.trim(),
      }),
    })
    if (r.ok) setRefreshTick(t => t + 1)
  }

  // Drag-and-drop handler (T-5.1 / T-5.2). Optimistic update with
  // rollback on API error. react-arborist passes:
  //   { dragIds, parentId, index }
  // where parentId is the destination parent's id (or null for the
  // tree root, which Phase 2 doesn't allow), and index is 0-based.
  const handleMove: MoveHandler<ArboristNode> = async (args) => {
    if (!data) return
    const { dragIds, parentId, index } = args
    if (parentId === null) {
      toast.show('Cannot move a node to the document root.', 'error')
      return
    }
    if (dragIds.length !== 1) return
    const nodeId = dragIds[0]

    // Find moved node and old parent for the rollback / lookup info
    const movedNode = findInTree(data, nodeId)
    const newParent = findInTree(data, parentId)
    if (!movedNode || !newParent) return

    // Snapshot for rollback. Deep clone via JSON round-trip — the
    // tree is small (low thousands of nodes max in Phase 2) so cost
    // is negligible.
    const snapshot: ArboristNode[] = JSON.parse(JSON.stringify(data))

    // Optimistic update: rebuild tree with moved node in new place.
    setData(applyMoveOptimistic(data, nodeId, parentId, index))

    // Send PATCH
    const r = await fetch(`/api/nodes/${nodeId}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, position: index }),
    })

    if (r.ok) {
      // Refresh from server to pick up canonical order/depth values.
      setRefreshTick(t => t + 1)
      return
    }

    // Rollback + toast.
    setData(snapshot)
    const body = await r.json().catch(() => ({}))
    const movedType = movedNode.data.node_type
    const newParentType = newParent.data.node_type
    switch (body?.error) {
      case 'cycle_detected':
        toast.show('Cannot move a node inside itself.', 'error')
        break
      case 'layer_violation':
        toast.show(`${cap(movedType)}s belong inside their permitted parent layer, not ${newParentType}s.`, 'error')
        break
      case 'invalid_parent':
        toast.show('Cannot move between documents.', 'error')
        break
      case 'node_locked':
        toast.show(`This ${movedType} is locked. Unlock the layer to move it.`, 'error')
        break
      case 'parent_locked':
        toast.show('This destination is locked. Unlock the layer to move into it.', 'error')
        break
      case 'invalid_position':
        toast.show('Invalid drop position.', 'error')
        break
      default:
        toast.show('Move failed.', 'error')
    }
  }

  if (error !== null) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Failed to load tree.
      </div>
    )
  }
  if (data === null) {
    return <LoadingSkeleton />
  }

  const layerLabels = documentType ? LAYER_LABELS[documentType] : undefined
  const childTypes  = documentType ? NODE_TYPES[documentType]   : undefined

  // Empty state: tree has only the root node and no descendants.
  // Show a hint pointing at the row's + button.
  const isEmpty = data.length === 1 && !data[0].children
  const firstChildType = childTypes?.[1]

  return (
    <NodeActionsProvider
      value={{
        onMore: handleMore,
        onAddChild: handleAddChild,
      }}
    >
      <div
        style={{
          background: 'var(--color-bg-base)',
          padding: '8px 0',
          height: '100%',
          overflow: 'auto',
        }}
      >
        {layerLabels && (
          <div style={{ display: 'flex', flexWrap: 'wrap', padding: '0 8px' }}>
            {layerLabels.map((label, i) => (
              <div key={label} style={{ flex: '0 0 auto', minWidth: '80px', borderTop: i === 0 ? 'none' : undefined }}>
                <LayerDivider label={label} />
              </div>
            ))}
          </div>
        )}
        {/*
          SU-J13-1 (Mars-drive 2026-05-09): react-arborist tracks
          per-node open state internally and only consults
          `openByDefault` on first mount. After Accept causes new
          children to appear under an existing node, the parent stays
          collapsed and the user can't see the new content without a
          page reload. Keying the Tree on (refreshKey + refreshTick)
          forces a remount on each mutation-driven refetch so
          openByDefault re-applies. Trade-off: scroll position resets,
          which is acceptable given the alternative is invisible
          children.
         */}
        <Tree<ArboristNode>
          key={`${refreshKey ?? 0}-${refreshTick}`}
          data={data}
          rowHeight={36}
          width="100%"
          height={600}
          indent={16}
          openByDefault
          idAccessor="id"
          onMove={handleMove}
          onSelect={(nodes) => onSelect?.(nodes[0]?.id ?? null)}
        >
          {NodeRow}
        </Tree>
        {isEmpty && firstChildType && (
          <p
            data-testid="empty-tree-hint"
            style={{
              marginTop: '4px',
              paddingLeft: '40px',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
              opacity: 0.7,
              fontStyle: 'italic',
            }}
          >
            Hover the row and click + to add your first {firstChildType}.
          </p>
        )}
      </div>
      {moreMenu && (
        <NodeMoreMenu
          nodeId={moreMenu.nodeId}
          anchor={moreMenu.anchor}
          isRoot={moreMenu.isRoot}
          onClose={() => setMoreMenu(null)}
          onMutated={() => setRefreshTick(t => t + 1)}
        />
      )}
    </NodeActionsProvider>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Loading skeleton — chevron + indent placeholder rows. No spinners
// per Component Spec §4.1's intent (the tree is information, not an
// event surface). Fades in via opacity to avoid drawing attention.
function LoadingSkeleton() {
  // A few rows at varying depths to suggest the tree shape.
  const rows: { depth: number; width: number }[] = [
    { depth: 0, width: 140 },
    { depth: 1, width: 110 },
    { depth: 2, width: 130 },
    { depth: 2, width: 100 },
    { depth: 1, width: 90 },
  ]
  return (
    <div data-testid="tree-skeleton" style={{ padding: '8px 0', opacity: 0.5 }}>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            height: '36px',
            paddingLeft: `${8 + r.depth * 16}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <span style={{ width: '8px', color: 'var(--color-text-muted)', fontSize: '10px' }}>▾</span>
          <span style={{ width: '14px', textAlign: 'center', color: 'var(--color-text-muted)' }}>·</span>
          <span
            style={{
              display: 'inline-block',
              height: '10px',
              width: `${r.width}px`,
              background: 'var(--color-border-subtle)',
              borderRadius: '2px',
            }}
          />
        </div>
      ))}
    </div>
  )
}

// Optimistic tree mutation: remove `nodeId` from its current parent
// and insert it at `index` in the new parent's children. Returns a
// new tree (not mutating the original). Used by handleMove before
// the API round-trip; rolled back on failure via the snapshot.
function applyMoveOptimistic(
  tree: ArboristNode[],
  nodeId: string,
  newParentId: string,
  index: number,
): ArboristNode[] {
  let movedNode: ArboristNode | null = null

  function strip(nodes: ArboristNode[]): ArboristNode[] {
    const out: ArboristNode[] = []
    for (const n of nodes) {
      if (n.id === nodeId) {
        movedNode = n
        continue
      }
      const stripped = n.children ? strip(n.children) : undefined
      out.push({
        ...n,
        ...(stripped && stripped.length > 0 ? { children: stripped } : {}),
      })
    }
    return out
  }

  const stripped = strip(tree)
  if (!movedNode) return tree

  function insert(nodes: ArboristNode[]): ArboristNode[] {
    return nodes.map(n => {
      if (n.id === newParentId) {
        const children = n.children ? [...n.children] : []
        children.splice(index, 0, movedNode!)
        return { ...n, children }
      }
      if (n.children) {
        return { ...n, children: insert(n.children) }
      }
      return n
    })
  }

  return insert(stripped)
}

// Build a parent → children tree from the flat (depth-first ordered)
// array returned by GET /api/documents/[id]/nodes. The route already
// applies a depth-first sort, so siblings are encountered in order.
function buildTree(rows: NodeData[]): ArboristNode[] {
  const byParent = new Map<string | null, NodeData[]>()
  for (const r of rows) {
    const arr = byParent.get(r.parent_id) ?? []
    arr.push(r)
    byParent.set(r.parent_id, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order)

  function build(parentId: string | null): ArboristNode[] {
    return (byParent.get(parentId) ?? []).map(row => {
      const children = build(row.id)
      return {
        id:   row.id,
        name: row.name ?? '(untitled)',
        data: row,
        // react-arborist treats `children: []` as "has children, all
        // loaded (zero of them)" — which renders a chevron for an
        // empty branch. Leaves must omit the field (or pass undefined)
        // for the chevron to be hidden / isLeaf to be true.
        ...(children.length > 0 ? { children } : {}),
      }
    })
  }
  return build(null)
}

