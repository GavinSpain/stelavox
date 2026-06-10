'use client'

// Phase 8 nav refactor: shared document chrome for every mode.
//
// What lives here:
//   - selectedNodeId state (LAYOUT-LEVEL — survives mode-switch
//     navigation between /edit, /director, /scheduler because Next.js
//     App Router preserves layout components across sub-route changes)
//   - DocumentTitleStrip + FilterChipsRow + NodeTree (left pane)
//   - useSidebarProject() + setProject lifecycle (so the Sidebar's
//     Context Library scopes to this document)
//   - useMode().setEnabled() — flips the global ModeTabBar visible
//     while a document is mounted
//   - DocumentContext provider — exposes projectId / documentId /
//     selectedNodeId etc. to mode-specific body components rendered as
//     `children` (the matched page.tsx for /edit, /director, or
//     /scheduler)
//
// What does NOT live here:
//   - Mode-specific right-panel content. Each mode's page.tsx is a
//     thin server-component shell that renders a client body which
//     reads DocumentContext and pushes its content into the right slot
//     via useRightSlot().

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { NodeTree } from '@/components/tree/NodeTree'
import { DocumentTitleStrip } from '@/components/tree/DocumentTitleStrip'
import { FilterChipsRow } from '@/components/tree/FilterChipsRow'
import { useSidebarProject } from '@/components/layout/AppShell'
import { useMode } from '@/components/layout/ModeContext'

// ───────────────────────────────────────────────────────────────────
// DocumentContext — used by mode body components to read shared state.
// ───────────────────────────────────────────────────────────────────

interface DocumentContextValue {
  projectId: string
  documentId: string
  documentName: string
  documentType: 'novel' | 'short_story' | 'series'
  documentUpdatedAt: string | null
  profileId: string | null
  projectName: string | null
  selectedNodeId: string | null
  setSelectedNodeId: (id: string | null) => void
  refreshKey: number
  bumpRefresh: () => void
}

const DocumentContext = createContext<DocumentContextValue | null>(null)

export function useDocument() {
  const ctx = useContext(DocumentContext)
  if (!ctx) {
    throw new Error('useDocument must be used inside DocumentLayoutClient')
  }
  return ctx
}

// ───────────────────────────────────────────────────────────────────

interface Props {
  projectId: string
  documentId: string
  documentName: string
  documentType: 'novel' | 'short_story' | 'series'
  documentUpdatedAt?: string | null
  profileId?: string | null
  projectName?: string | null
  children: React.ReactNode
}

export function DocumentLayoutClient({
  projectId,
  documentId,
  documentName,
  documentType,
  documentUpdatedAt,
  profileId,
  projectName,
  children,
}: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  // Phase 8 nav cleanup follow-up (2026-06-09) — selecting a node is
  // a "show me this node" verb regardless of which mode owns the right
  // slot. The tree is persistent chrome across Edit / Director /
  // Scheduler, but in Director or Scheduler modes their respective
  // panels own the right slot — so a tree click that only updated
  // state produced no visible change. Author intuition: clicking a
  // node should navigate to Edit mode for that node. Director and
  // Scheduler are operations on the work; the work itself is Edit.
  //
  // The layout persists across sub-route changes (Next.js App Router
  // contract), so the selectedNodeId state survives the router.push
  // and the Edit mode body's NodeDetailPanel mounts on the new route.
  const router = useRouter()
  const pathname = usePathname()
  const editPath = useMemo(
    () => `/projects/${projectId}/documents/${documentId}`,
    [projectId, documentId],
  )
  const selectNode = useCallback(
    (id: string | null, source: 'click' | 'auto' = 'click') => {
      setSelectedNodeId(id)
      // Auto-select on first data load (source: 'auto') must NOT
      // redirect — otherwise a direct page-load on /director or
      // /scheduler bounces the user back to /edit when the tree
      // initialises with a default selection.
      if (id !== null && source === 'click' && pathname !== editPath) {
        router.push(editPath)
      }
    },
    [pathname, editPath, router],
  )

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

  const { setProject } = useSidebarProject()
  const { setEnabled } = useMode()

  useEffect(() => {
    setProject({
      projectId,
      documentId,
      projectName: projectName ?? null,
      documentName,
      // Clicking a node in the Sidebar's Context Library has the same
      // mental model as clicking one in the tree — route through
      // selectNode so it navigates to Edit when invoked from Director
      // or Scheduler mode.
      onSelectContextNode: selectNode,
    })
    return () => {
      setProject({
        projectId: null,
        documentId: null,
        projectName: null,
        documentName: null,
        onSelectContextNode: null,
      })
    }
  }, [projectId, documentId, projectName, documentName, setProject, selectNode])

  // Enable the global ModeTabBar (and ⌘. shortcut) while a document
  // layout is mounted. Disabling on unmount returns the bar to its
  // disabled state on non-document routes.
  useEffect(() => {
    setEnabled(true)
    return () => setEnabled(false)
  }, [setEnabled])

  const ctxValue: DocumentContextValue = {
    projectId,
    documentId,
    documentName,
    documentType,
    documentUpdatedAt: documentUpdatedAt ?? null,
    profileId: profileId ?? null,
    projectName: projectName ?? null,
    selectedNodeId,
    setSelectedNodeId,
    refreshKey,
    bumpRefresh,
  }

  return (
    <DocumentContext.Provider value={ctxValue}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <DocumentTitleStrip
          projectId={projectId}
          projectName={projectName ?? null}
          documentName={documentName}
          documentType={documentType}
          documentUpdatedAt={documentUpdatedAt ?? null}
        />
        <FilterChipsRow />
        <div style={{ flex: 1, minHeight: 0 }}>
          <NodeTree
            documentId={documentId}
            documentType={documentType}
            onSelect={selectNode}
            selectedId={selectedNodeId}
            refreshKey={refreshKey}
          />
        </div>
        {/* `children` is the matched mode page (page.tsx in /, /director,
           or /scheduler). The body components consume useDocument() and
           push their content into the right slot via useRightSlot().
           They render nothing in the layout tree (they're effect-only). */}
        {children}
      </div>
    </DocumentContext.Provider>
  )
}
