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

import { useEffect, useState } from 'react'
import { Tree } from 'react-arborist'
import { NodeRow, type ArboristNode, type NodeData } from './NodeRow'

interface NodeTreeProps {
  documentId: string
}

export function NodeTree({ documentId }: NodeTreeProps) {
  const [data, setData]   = useState<ArboristNode[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  }, [documentId])

  if (error !== null) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Failed to load tree.
      </div>
    )
  }
  if (data === null) {
    return (
      <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
        Loading…
      </div>
    )
  }

  return (
    <div
      role="tree"
      style={{
        background: 'var(--color-bg-base)',
        padding: '8px 0',
        height: '100%',
        overflow: 'auto',
      }}
    >
      <Tree<ArboristNode>
        data={data}
        rowHeight={36}
        width="100%"
        height={600}
        indent={16}
        openByDefault
        idAccessor="id"
      >
        {NodeRow}
      </Tree>
    </div>
  )
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

