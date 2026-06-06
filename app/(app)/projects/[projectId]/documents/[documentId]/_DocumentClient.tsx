'use client'

// Spec: stelavox_phase2_build_checklist_v1_0.md v1.1 §3.6
//       stelavox_phase4_build_checklist_v1_0.md §3.4 T-4.3
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1 (G-12)
//
// Client-side wrapper for the document page. The page itself is an
// async server component (auth + document lookup); this component
// holds selectedNodeId + treeRefreshKey + mode and pushes the right
// panel content into AppShell's right slot.
//
// Phase 4: tells the Sidebar which project + document is active so
// sidebar context-row clicks open the detail panel.
//
// Phase 5b (G-12): when the global ModeTabBar is on Director, the
// right-slot content swaps from NodeDetailPanel to DirectorPanel.
// The node selection persists across the swap so toggling back to
// Edit returns the user to where they were.

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { NodeTree } from '@/components/tree/NodeTree'
import { NodeDetailPanel } from '@/components/detail/NodeDetailPanel'
import { DirectorPanel } from '@/components/director/DirectorPanel'
import { DocumentExportButton } from '@/components/export/DocumentExportButton'
import { DocumentTitleStrip } from '@/components/tree/DocumentTitleStrip'
import { FilterChipsRow } from '@/components/tree/FilterChipsRow'
import { useRightSlot, useSidebarProject } from '@/components/layout/AppShell'
import { useMode } from '@/components/layout/ModeContext'

interface Props {
  projectId: string
  documentId: string
  documentName: string
  documentType: 'novel' | 'short_story' | 'series'
  /** ISO timestamp from documents.updated_at — drives the title-strip
   *  meta-line "last edit X ago". Optional for backwards-compat. */
  documentUpdatedAt?: string | null
  profileId?: string | null
  /** Optional — surfaced in the Sidebar PROJECT slot. */
  projectName?: string | null
}

const DIRECTOR_MIN_WIDTH = 400 // Component Spec §7.1

export function DocumentClient({
  projectId,
  documentId,
  documentName,
  documentType,
  documentUpdatedAt,
  profileId,
  projectName,
}: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Phase 8.01.D OQ-5 — honour `?selectedNode={nodeId}` query param.
  // The Resume Writing hero on the dashboard (and future deep-link
  // surfaces) navigate here with the target beat in the URL; selecting
  // it on mount drops the author straight into the right node's detail
  // panel. Graceful degradation: a missing or bad id is silently ignored
  // and the default state takes over.
  const searchParams = useSearchParams()
  useEffect(() => {
    const fromQuery = searchParams?.get('selectedNode')
    if (fromQuery && fromQuery.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedNodeId(fromQuery)
    }
    // Intentionally one-shot — only honour the param on mount; later
    // tree clicks must not reset to the query value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const { setContent, setMinWidthOverride } = useRightSlot()
  const { setProject } = useSidebarProject()
  const { mode, setEnabled, setMode } = useMode()

  useEffect(() => {
    setProject({
      projectId,
      documentId,
      projectName: projectName ?? null,
      documentName,
      onSelectContextNode: (id: string) => setSelectedNodeId(id),
    })
    return () => {
      setProject({ projectId: null, documentId: null, projectName: null, documentName: null, onSelectContextNode: null })
    }
  }, [projectId, documentId, projectName, documentName, setProject])

  // Enable the global ModeTabBar (and ⌘. shortcut) while a document
  // client is mounted. Disabling on unmount returns the bar to its
  // disabled state on non-document routes.
  useEffect(() => {
    setEnabled(true)
    return () => setEnabled(false)
  }, [setEnabled])

  // Push the right-slot content based on (mode, selectedNodeId).
  useEffect(() => {
    if (mode === 'director') {
      setMinWidthOverride(DIRECTOR_MIN_WIDTH)
      setContent(
        <DirectorPanel
          documentId={documentId}
          documentName={documentName}
          profileId={profileId}
          onClose={() => setMode('edit')}
        />,
      )
      return () => {
        setContent(null)
        setMinWidthOverride(null)
      }
    }
    // Edit mode
    if (!selectedNodeId) {
      setContent(null)
      return
    }
    setContent(
      <NodeDetailPanel
        nodeId={selectedNodeId}
        refreshKey={refreshKey}
        onMutated={() => setRefreshKey((k) => k + 1)}
        onClose={() => setSelectedNodeId(null)}
        onSelectNode={setSelectedNodeId}
      />,
    )
    return () => setContent(null)
  }, [
    mode,
    selectedNodeId,
    refreshKey,
    documentId,
    documentName,
    profileId,
    setContent,
    setMinWidthOverride,
    setMode,
  ])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <DocumentTitleStrip
        projectId={projectId}
        projectName={projectName ?? null}
        documentName={documentName}
        documentType={documentType}
        documentUpdatedAt={documentUpdatedAt ?? null}
        rightSlot={
          <DocumentExportButton
            documentId={documentId}
            documentName={documentName}
            projectId={projectId}
          />
        }
      />
      <FilterChipsRow />
      <div style={{ flex: 1, minHeight: 0 }}>
        <NodeTree
          documentId={documentId}
          documentType={documentType}
          onSelect={setSelectedNodeId}
          refreshKey={refreshKey}
        />
      </div>
    </div>
  )
}
