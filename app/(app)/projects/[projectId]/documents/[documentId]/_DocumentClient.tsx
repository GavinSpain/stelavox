'use client'

// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.6
//
// Client-side wrapper for the document page. The page itself is an
// async server component (it does the auth/document lookup); this
// component holds the selectedNodeId + treeRefreshKey state and
// pushes <NodeDetailPanel> into AppShell's right slot via
// useRightSlot() when a node is selected.

import { useEffect, useState } from 'react'
import { NodeTree } from '@/components/tree/NodeTree'
import { NodeDetailPanel } from '@/components/detail/NodeDetailPanel'
import { useRightSlot } from '@/components/layout/AppShell'

interface Props {
  documentId: string
  documentType: 'novel' | 'short_story' | 'series'
}

export function DocumentClient({ documentId, documentType }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { setContent } = useRightSlot()

  // Push the detail panel into AppShell's right slot when a node is
  // selected. Cleanup restores the default placeholder.
  useEffect(() => {
    if (!selectedNodeId) {
      setContent(null)
      return
    }
    setContent(
      <NodeDetailPanel
        nodeId={selectedNodeId}
        refreshKey={refreshKey}
        onMutated={() => setRefreshKey(k => k + 1)}
        onClose={() => setSelectedNodeId(null)}
      />
    )
    return () => setContent(null)
  }, [selectedNodeId, refreshKey, setContent])

  return (
    <NodeTree
      documentId={documentId}
      documentType={documentType}
      onSelect={setSelectedNodeId}
      refreshKey={refreshKey}
    />
  )
}
