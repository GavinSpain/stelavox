'use client'

// Phase 8 nav refactor — Edit mode body.
//
// Consumes DocumentContext (provided by _DocumentLayoutClient) to read
// selectedNodeId + setSelectedNodeId + refreshKey. Pushes the
// NodeDetailPanel into the right slot via useRightSlot. Renders no DOM
// of its own.

import { useEffect } from 'react'

import { NodeDetailPanel } from '@/components/detail/NodeDetailPanel'
import { useRightSlot } from '@/components/layout/AppShell'

import { useDocument } from './_DocumentLayoutClient'

export function EditModeBody() {
  const { selectedNodeId, setSelectedNodeId, refreshKey, bumpRefresh } = useDocument()
  const { setContent, setMinWidthOverride } = useRightSlot()

  useEffect(() => {
    // Edit mode never sets a min-width override.
    setMinWidthOverride(null)
    if (!selectedNodeId) {
      setContent(null)
      return
    }
    setContent(
      <NodeDetailPanel
        nodeId={selectedNodeId}
        refreshKey={refreshKey}
        onMutated={bumpRefresh}
        // Phase 8.2 — no onClose. The detail panel is the author's
        // workspace; closing it just leaves an empty right slot with
        // no path back. Selection only changes by clicking another
        // tree row.
        onSelectNode={setSelectedNodeId}
      />,
    )
    return () => setContent(null)
  }, [
    selectedNodeId,
    refreshKey,
    bumpRefresh,
    setSelectedNodeId,
    setContent,
    setMinWidthOverride,
  ])

  return null
}
