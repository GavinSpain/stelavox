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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Tree } from 'react-arborist'
import type { MoveHandler } from 'react-arborist'
import { useQueryClient } from '@tanstack/react-query'

import { NodeRow, NodeActionsProvider, type ArboristNode, type NodeData } from './NodeRow'
// Legacy LayerDivider was used as an inline horizontal legend at the
// top of the tree pane. Phase 8.01 round-3 replaces that with the
// wireframe-spec'd compact TreeLayerHeader strip. The wireframe also
// drew indent guide-lines, but the author found them distracting in
// the live build — the bracketed `[Book]`/`[Act]` row labels already
// carry the same signal, and the guides were doubling up. Removed in
// round-3 follow-up.
import { TreeLayerHeader } from './TreeLayerHeader'
import { NodeMoreMenu } from './NodeMoreMenu'
import { ToastProvider, useToast } from '@/components/feedback/Toast'
import { useNodesRealtime } from '@/lib/hooks/useNodesRealtime'
import { useDocumentNodes } from '@/lib/queries/useDocumentNodes'
import { documentKeys } from '@/lib/queries/keys'
import { TreeSkeleton } from '@/components/feedback/skeletons/TreeSkeleton'
import { QueryErrorFallback } from '@/components/feedback/QueryErrorFallback'

interface NodeTreeProps {
  documentId: string
  documentType?: 'novel' | 'short_story' | 'series'
  // Notified when a row is selected (clicked). Passed through to the
  // parent so it can populate AppShell's right slot with a detail panel.
  onSelect?: (nodeId: string | null) => void
  // External refresh trigger — when this prop changes, the tree refetches.
  // Used by NodeDetailPanel mutations to keep the tree in sync.
  refreshKey?: number
  // Phase 8.2 — current selection from the parent. The tree uses this
  // to decide whether to auto-select a default on first data load:
  // if `selectedId` is null after the initial fetch resolves, the
  // tree fires onSelect with the first leaf (or root, if no leaves
  // exist yet). This eliminates the "Node detail" empty state in
  // the common case of opening a document.
  selectedId?: string | null
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

function NodeTreeInner({ documentId, documentType, onSelect, refreshKey, selectedId }: NodeTreeProps) {
  const toast = useToast()
  const queryClient = useQueryClient()
  // Phase 8.2 — track whether we've auto-selected for the current
  // documentId yet. Resets when the documentId changes so navigating
  // to a different document re-auto-selects there.
  const autoSelectedForDoc = useRef<string | null>(null)

  // Phase 8.5b B.3 — data + error state move into TanStack Query.
  // useDocumentNodes wraps the same GET /api/documents/[id]/nodes
  // fetch in a cache-keyed query (documentKeys.nodes(documentId)). The
  // built-tree derivation lives in a useMemo against the query data.
  const queryResult = useDocumentNodes(documentId)
  const rawNodes = queryResult.data
  const isLoading = queryResult.isLoading
  const error = queryResult.error ? 'fetch_failed' : null
  const data = useMemo(
    () => (rawNodes ? buildTree(rawNodes as never[]) : null),
    [rawNodes],
  )

  // Phase 8.01 round-3 follow-up — remountTick still drives the
  // react-arborist Tree key for INSERT/DELETE structural changes so
  // openByDefault re-applies on remount. dataTick is gone: B.3 routes
  // refetch through queryClient.invalidateQueries instead.
  const [remountTick, setRemountTick] = useState(0)
  const [moreMenu, setMoreMenu] = useState<{ nodeId: string; anchor: HTMLElement; isRoot: boolean; parentNodeId: string | null } | null>(null)

  // Auto-select after first data lands (replaces the old fetch-then-set
  // side-effect; runs whenever rawNodes transitions from undefined to
  // an array of >=1 row).
  useEffect(() => {
    if (!onSelect || !data || data.length === 0) return
    if (autoSelectedForDoc.current === documentId) return
    if (selectedId != null) return
    autoSelectedForDoc.current = documentId
    const defaultId = pickDefaultSelection(data)
    if (defaultId) onSelect(defaultId)
  }, [data, documentId, onSelect, selectedId])

  // Phase 5 / B.3 / B.3b — Realtime nodes-table events:
  //   - When NodesPatcherMount is in scope (app shell mounted the
  //     direct patcher channel — B.3b), skip the invalidate. The
  //     patcher updates the cache in place; useQuery re-renders
  //     against the new data automatically. We still bump remountTick
  //     on structural changes so react-arborist's openByDefault
  //     re-evaluates (preserves the SU-J13-1 invisible-children fix).
  //   - When NodesPatcherMount is NOT in scope (legacy fallback;
  //     development reload edge cases), invalidate to keep behaviour
  //     identical to the B.3 substrate.
  // B.5 swaps useNodesRealtime for the user-channel demuxer.
  const triggerRefetch = useCallback(
    (kind: 'structural' | 'data') => {
      if (!documentId) return
      const patcherMounted =
        typeof window !== 'undefined' && !!window.__stelavox_nodes_patcher_mounted
      if (!patcherMounted) {
        void queryClient.invalidateQueries({ queryKey: documentKeys.nodes(documentId) })
      }
      if (kind === 'structural') setRemountTick((t) => t + 1)
    },
    [documentId, queryClient],
  )
  useNodesRealtime(documentId, triggerRefetch)

  // Local mutations (Add Child, Move, NodeDetailPanel onMutated) call
  // this — known structural by construction. Invalidate immediately
  // rather than waiting for the Realtime echo.
  const bumpStructural = useCallback(() => {
    if (!documentId) return
    void queryClient.invalidateQueries({ queryKey: documentKeys.nodes(documentId) })
    setRemountTick((t) => t + 1)
  }, [documentId, queryClient])

  // External refreshKey nudges — keep parity with the pre-B.3 path.
  useEffect(() => {
    if (!documentId || refreshKey === undefined) return
    void queryClient.invalidateQueries({ queryKey: documentKeys.nodes(documentId) })
  }, [refreshKey, documentId, queryClient])

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
    setMoreMenu({
      nodeId,
      anchor,
      isRoot: node.data.parent_id === null,
      parentNodeId: node.data.parent_id ?? null,
    })
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
      // SU-22 (round-3 follow-up): native window.alert blocks the renderer
      // and is opaque to MCP/Playwright drivers. Toast carries the same
      // message in-DOM and unblocks autonomous testing.
      toast.show('No deeper layer available beneath this node.', 'error')
      return
    }
    // SU-22 fix: skip window.prompt for the new node's name. The native
    // dialog froze the renderer and was undriveable from the launch-
    // standard test harness. Generate a sensible default (`Act 3`,
    // `Chapter 5`, etc.) from the existing sibling count so the row
    // appears immediately; the author renames via the More menu's
    // Rename action (also de-prompted in this commit) or the inline
    // header rename in NodeDetailPanel.
    const siblingCount = parent.children?.length ?? 0
    const typeLabel = childType.charAt(0).toUpperCase() + childType.slice(1)
    const defaultName = `${typeLabel} ${siblingCount + 1}`
    const r = await fetch(`/api/documents/${documentId}/nodes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        parent_id: parentId,
        node_type: childType,
        name: defaultName,
      }),
    })
    if (r.ok) bumpStructural()
    else toast.show(`Could not add ${childType}.`, 'error')
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

    // Phase 8.5b B.3 — the pre-B.3 path snapshot-and-restored a local
    // `data` state for optimistic feedback. Under TanStack Query the
    // optimistic update would patch the flat node array via
    // setQueryData; the current move payload only carries
    // (nodeId, parentId, position) and a robust cache-side optimistic
    // update needs to recompute depth / order values that the server
    // canonicalises. Out of scope for B.3 — the move action now
    // posts and re-fetches on success, the same way bumpStructural()
    // path already worked. UX feel is slightly less immediate;
    // optimistic moves can land in a follow-up if measurements justify.

    // Send PATCH
    const r = await fetch(`/api/nodes/${nodeId}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parent_id: parentId, position: index }),
    })

    if (r.ok) {
      // Refresh from server to pick up canonical order/depth values.
      bumpStructural()
      return
    }

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
      <QueryErrorFallback
        error={queryResult.error}
        onRetry={() => {
          if (documentId) {
            void queryClient.invalidateQueries({ queryKey: documentKeys.nodes(documentId) })
          }
        }}
        label="Tree failed to load"
      />
    )
  }
  if (isLoading || data === null) {
    return <TreeSkeleton />
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
          height: '100%',
          overflow: 'auto',
          position: 'relative',
        }}
      >
        {/* Phase 8.01 wireframe-alignment round 3 — Tree layer column
            header replaces the legacy LayerDivider strip. The
            wireframe-spec'd compact tinted strip orients the reader
            in the layered hierarchy. The bracketed row labels carry
            the rest of the signal — the wireframe's vertical indent
            guides were dropped because they were doubling up with
            the per-row [Book]/[Act] labels. */}
        {layerLabels && <TreeLayerHeader />}
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
          key={`${refreshKey ?? 0}-${remountTick}`}
          data={data}
          // Phase 8.01.A T-5: 44px universal (was 36) per Component Spec
          // v2.21 §4.2 wireframe lock. react-arborist requires the height
          // here AND inside NodeRow's inline style; the Tree's virtualised
          // list uses this value to lay out rows, NodeRow uses its inline
          // style for the actual row content.
          rowHeight={44}
          width="100%"
          height={600}
          indent={16}
          openByDefault
          idAccessor="id"
          onMove={handleMove}
          onSelect={(nodes) => {
            // Migration 042 / SU-J13-1 follow-up: the Tree is keyed on
            // (refreshKey + refreshTick) and remounts on every realtime
            // nodes-table change so newly-Accepted children become visible
            // without a manual reload. react-arborist fires onSelect with
            // an empty array on that remount, which previously cleared
            // selectedNodeId upstream and made NodeDetailPanel disappear
            // mid-edit. Only forward a real selection; the deliberate
            // "click empty space to deselect" path is wired separately
            // and does not flow through this callback.
            if (nodes.length > 0) onSelect?.(nodes[0].id)
          }}
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
          parentNodeId={moreMenu.parentNodeId}
          onClose={() => setMoreMenu(null)}
          onMutated={() => bumpStructural()}
        />
      )}
    </NodeActionsProvider>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Phase 8.2 — pick the default selection on a fresh document load.
 *
 * Strategy:
 *   1. First leaf in canonical (depth-first) order — puts the cursor
 *      where the author will actually write
 *   2. Failing that, the first/root node — gives the author the
 *      structure overview with the "+ add child" affordance
 *   3. Failing that, null — caller falls back to the empty-state hint
 *
 * "Leaf" follows H-15: server-derived `is_leaf` on the node payload.
 * We never infer leaf-ness from child-count client-side.
 */
function pickDefaultSelection(tree: ArboristNode[]): string | null {
  const firstLeaf = findFirstLeaf(tree)
  if (firstLeaf) return firstLeaf
  if (tree.length > 0) return tree[0].id
  return null
}

function findFirstLeaf(nodes: ArboristNode[]): string | null {
  for (const n of nodes) {
    if (n.data.is_leaf) return n.id
    if (n.children && n.children.length > 0) {
      const childLeaf = findFirstLeaf(n.children)
      if (childLeaf) return childLeaf
    }
  }
  return null
}

// Loading skeleton — chevron + indent placeholder rows. No spinners
// per Component Spec §4.1's intent (the tree is information, not an
// event surface). Fades in via opacity to avoid drawing attention.
// Phase 8.5b B.3 — replaced by TreeSkeleton from components/feedback/
// skeletons/. Function kept (prefixed) for one release cycle in case a
// downstream consumer reaches in to import it; remove in B.6 polish.
function _LoadingSkeleton() {
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
// Phase 8.5b B.3 — no longer called from the move handler (the path
// now invalidates + refetches rather than patching the cache locally
// because the server canonicalises order + depth). Kept (prefixed) for
// one release cycle; remove in B.6 polish.
function _applyMoveOptimistic(
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
export function buildTree(rows: NodeData[]): ArboristNode[] {
  const byParent = new Map<string | null, NodeData[]>()
  for (const r of rows) {
    const arr = byParent.get(r.parent_id) ?? []
    arr.push(r)
    byParent.set(r.parent_id, arr)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order)

  // Phase 8.01 round-3 follow-up — aggregate word_count_actual up the
  // tree so non-leaf rows display the sum of their descendant leaves'
  // actuals instead of the literal 0 the DB carries for non-leaves.
  // The recursion produces aggregated children FIRST, so the parent's
  // reduce sums already-aggregated child values — propagation is
  // automatic at every level. Targets are NOT aggregated: they're
  // authored independently at each level (and may legitimately differ
  // from the sum of children — the author may target an Act at 12k
  // even if its scenes' targets sum to 14k).
  function build(parentId: string | null): ArboristNode[] {
    return (byParent.get(parentId) ?? []).map(row => {
      const children = build(row.id)
      const aggregateActual = children.length === 0
        ? (row.word_count_actual ?? 0)
        : children.reduce((sum, c) => sum + (c.data.word_count_actual ?? 0), 0)
      const aggregatedRow: NodeData =
        children.length === 0 || aggregateActual === (row.word_count_actual ?? 0)
          ? row
          : { ...row, word_count_actual: aggregateActual }
      return {
        id:   row.id,
        name: row.name ?? '(untitled)',
        data: aggregatedRow,
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

