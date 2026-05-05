'use client'

// Spec: stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_component_specification_v2_0.md §2.1 (AppShell)
//       wireframes/wireframe_edit_mode_v1.html (visual reference)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.1
//
// AppShell — root layout for the authenticated app. Column flex with a
// fixed 48px Header on top and a horizontal three-column body row beneath:
//
//   ┌────────────────────────────────────────────────────────────┐ 48px
//   │                          Header                            │
//   ├──────────┬─────────────────────────────────┬───────────────┤
//   │ Sidebar  │  centre slot — children         │  DetailPanel  │
//   │  220px   │  (NodeTree in §3.4; here it's   │   380px       │
//   │ [220-340]│   whatever the route renders)   │   [320-540]   │
//   └──────────┴─────────────────────────────────┴───────────────┘
//
// The middle and right slots are placeholders for §3.4 and Phase 3
// respectively. The middle slot renders `children` so the existing Phase 1
// pages (dashboard, project list, document page) keep working — when §3.4
// lands, the document page will render the NodeTree, which naturally fills
// this slot. The right slot renders the muted "Node detail" label until
// Phase 3 wires up the real detail panel.
//
// State:
//   - sidebarWidth (220–340) — persisted in localStorage `stelavox_sidebar_width`
//   - detailWidth  (320–540) — persisted in localStorage `stelavox_detail_width`
// On hydration, server renders defaults; useEffect on mount reads localStorage
// and updates if a stored value exists. Brief one-frame flicker possible on
// first paint after F5 if the user has resized — acceptable for the stub.
//
// Note on Sidebar collapse interaction: the Sidebar's collapsed/expanded
// state lives inside Sidebar (localStorage `stelavox_sidebar_state`).
// AppShell controls the EXPANDED width via the `width` prop. When the
// Sidebar is collapsed it ignores `width` and renders 48px. Dragging the
// sidebar-tree resizer while the sidebar is collapsed updates the stored
// expanded-width preference but produces no visible movement until the
// user expands the sidebar again. Acceptable Phase 2 quirk; could be
// resolved later by lifting collapse state up to AppShell.

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { PanelResizer } from './PanelResizer'
import { createClient } from '@/lib/supabase/client'
import { useAgentJobsRealtime } from '@/lib/hooks/useAgentJobsRealtime'

// RightSlotContext lets any descendant of AppShell push content into
// the right-panel slot. Pages call useRightSlot() and call setContent
// with their own JSX (e.g. <NodeDetailPanel />). Returning to a route
// without a detail panel: the consumer effect sets null on cleanup,
// which restores the default placeholder.
const RightSlotContext = createContext<{
  setContent: (content: ReactNode | null) => void
}>({ setContent: () => {} })

export function useRightSlot() {
  return useContext(RightSlotContext)
}

// Phase 4: SidebarProjectContext lets pages tell the Sidebar which project
// is active (and optionally which document). The Sidebar uses this to fetch
// and render the Context library (Component Spec §2.3 + Phase 4 build
// checklist §3.4 T-4.1). The optional `onSelectContextNode` callback fires
// when a Sidebar row is clicked — pages with a detail-panel mechanism
// (the document page client) wire it to their selectedNodeId state so
// clicking a context node opens its detail panel.
//
// `refreshKey` lets pages force the Sidebar to re-fetch (after a context
// node was created or deleted via a different surface — e.g. a Picker
// flow on a structural node's Context tab).
export interface SidebarProjectState {
  projectId:             string | null
  documentId:            string | null
  onSelectContextNode:   ((id: string) => void) | null
  refreshKey:            number
}

const SidebarProjectContext = createContext<{
  state: SidebarProjectState
  setProject: (state: Partial<SidebarProjectState>) => void
  bumpRefresh: () => void
}>({
  state: { projectId: null, documentId: null, onSelectContextNode: null, refreshKey: 0 },
  setProject: () => {},
  bumpRefresh: () => {},
})

export function useSidebarProject() {
  return useContext(SidebarProjectContext)
}

const SIDEBAR_KEY = 'stelavox_sidebar_width'
const DETAIL_KEY  = 'stelavox_detail_width'

const SIDEBAR_DEFAULT = 220
const SIDEBAR_MIN     = 220
const SIDEBAR_MAX     = 340

const DETAIL_DEFAULT  = 380
const DETAIL_MIN      = 320
const DETAIL_MAX      = 540

interface AppShellProps {
  userEmail: string
  children: React.ReactNode
}

export function AppShell({ userEmail, children }: AppShellProps) {
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [detailWidth,  setDetailWidth]  = useState(DETAIL_DEFAULT)
  const [rightSlotContent, setRightSlotContent] = useState<ReactNode | null>(null)
  const [organisationId, setOrganisationId] = useState<string | null>(null)

  // Resolve the user's organisation_id once on mount so the agent_jobs
  // real-time subscription (Phase 5) can be filtered to this org.
  useEffect(() => {
    void (async () => {
      const supabase = createClient()
      const { data } = await supabase
        .from('organisation_members')
        .select('organisation_id')
        .limit(1)
        .maybeSingle()
      setOrganisationId(data?.organisation_id ?? null)
    })()
  }, [])

  // Mount the org-wide agent_jobs real-time subscription. All UI components
  // that show agent state (AgentTab, AgentActivityIndicator, AgentJobHistory)
  // read from this single subscription via useAgentJobs* selectors.
  useAgentJobsRealtime(organisationId)

  // Phase 4 sidebar project state.
  const [sidebarProjectState, setSidebarProjectState] = useState<SidebarProjectState>({
    projectId: null,
    documentId: null,
    onSelectContextNode: null,
    refreshKey: 0,
  })
  // useCallback so consumers' useEffect dep arrays don't see a new function
  // reference on every render — that caused an infinite update loop on the
  // project page (DocumentClient + ProjectSidebarSetup both list setProject
  // as a dependency).
  const setProject = useCallback((patch: Partial<SidebarProjectState>) => {
    setSidebarProjectState(prev => ({ ...prev, ...patch }))
  }, [])
  const bumpRefresh = useCallback(() => {
    setSidebarProjectState(prev => ({ ...prev, refreshKey: prev.refreshKey + 1 }))
  }, [])

  useEffect(() => {
    // Hydrate widths from localStorage. setState-in-effect is the standard
    // SSR-safe pattern for client-only storage; same exception as Sidebar.
    const sw = localStorage.getItem(SIDEBAR_KEY)
    if (sw !== null) {
      const n = Number(sw)
      if (Number.isFinite(n)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n)))
      }
    }
    const dw = localStorage.getItem(DETAIL_KEY)
    if (dw !== null) {
      const n = Number(dw)
      if (Number.isFinite(n)) {
        setDetailWidth(Math.max(DETAIL_MIN, Math.min(DETAIL_MAX, n)))
      }
    }
  }, [])

  function updateSidebar(w: number) {
    setSidebarWidth(w)
    localStorage.setItem(SIDEBAR_KEY, String(w))
  }

  function updateDetail(w: number) {
    setDetailWidth(w)
    localStorage.setItem(DETAIL_KEY, String(w))
  }

  return (
    <SidebarProjectContext.Provider value={{ state: sidebarProjectState, setProject, bumpRefresh }}>
    <RightSlotContext.Provider value={{ setContent: setRightSlotContent }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100vh',
          background: 'var(--color-bg-base)',
          overflow: 'hidden',
        }}
      >
      <div data-shell="header">
        <Header userEmail={userEmail} />
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div data-shell="sidebar" style={{ display: 'flex' }}>
          <Sidebar width={sidebarWidth} />
        </div>

        <PanelResizer
          position="sidebar-tree"
          value={sidebarWidth}
          onChange={updateSidebar}
          min={SIDEBAR_MIN}
          max={SIDEBAR_MAX}
        />

        <main
          data-shell="tree"
          style={{
            flex: 1,
            minWidth: '320px',
            overflowY: 'auto',
            background: 'var(--color-bg-base)',
          }}
        >
          {children}
        </main>

        <PanelResizer
          position="tree-detail"
          value={detailWidth}
          onChange={updateDetail}
          min={DETAIL_MIN}
          max={DETAIL_MAX}
        />

        <div
          data-shell="detail"
          aria-label="Detail panel"
          style={{
            width: `${detailWidth}px`,
            flexShrink: 0,
            background: rightSlotContent
              ? 'var(--color-bg-surface)'
              : 'var(--color-bg-base)',
            borderLeft: '1px solid var(--color-border-subtle)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {rightSlotContent ?? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Node detail
              </span>
            </div>
          )}
        </div>
      </div>
      </div>
    </RightSlotContext.Provider>
    </SidebarProjectContext.Provider>
  )
}
