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
import { usePathname } from 'next/navigation'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { TreeSlideOver } from './TreeSlideOver'
import { useViewportBreakpoint } from '@/lib/hooks/useViewportBreakpoint'
import { PanelResizer } from './PanelResizer'
import { ModeProvider } from './ModeContext'
import { AppShellStatusIndicator } from './AppShellStatusIndicator'
import { ExportProgressStack } from '@/components/export/ExportProgressStack'
import { createClient } from '@/lib/supabase/client'
import { useAgentJobsRealtime } from '@/lib/hooks/useAgentJobsRealtime'

// RightSlotContext lets any descendant of AppShell push content into
// the right-panel slot. Pages call useRightSlot() and call setContent
// with their own JSX (e.g. <NodeDetailPanel />). Returning to a route
// without a detail panel: the consumer effect sets null on cleanup,
// which restores the default placeholder.
//
// Phase 5b: setMinWidthOverride lets a consumer (DirectorPanel)
// raise the slot's minimum width while it is mounted (Director needs
// 400px minimum per Component Spec §7.1, vs. NodeDetailPanel's 320).
// Pass `null` (or omit) to clear the override.
const RightSlotContext = createContext<{
  setContent: (content: ReactNode | null) => void
  setMinWidthOverride: (px: number | null) => void
}>({ setContent: () => {}, setMinWidthOverride: () => {} })

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
  /** Display name surfaced in the Sidebar PROJECT slot. */
  projectName:           string | null
  /** Optional document name shown below the project name when a doc is loaded. */
  documentName:          string | null
  onSelectContextNode:   ((id: string) => void) | null
  refreshKey:            number
}

const SidebarProjectContext = createContext<{
  state: SidebarProjectState
  setProject: (state: Partial<SidebarProjectState>) => void
  bumpRefresh: () => void
}>({
  state: { projectId: null, documentId: null, projectName: null, documentName: null, onSelectContextNode: null, refreshKey: 0 },
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
const DETAIL_MAX      = 580 // Phase 5b: covers DirectorPanel max (was 540)

interface AppShellProps {
  userEmail: string
  children: React.ReactNode
}

export function AppShell({ userEmail, children }: AppShellProps) {
  return (
    <ModeProvider>
      <AppShellInner userEmail={userEmail}>{children}</AppShellInner>
    </ModeProvider>
  )
}

function AppShellInner({ userEmail, children }: AppShellProps) {
  // Phase 8.01.F T-5 — viewport awareness. Desktop + tablet-landscape
  // keep the current 3-pane flex layout (R-1 safety: no DOM tree change
  // at the most common breakpoints). Only tablet-portrait collapses the
  // left Sidebar into a slide-over.
  const breakpoint = useViewportBreakpoint()
  const isTabletPortrait = breakpoint === 'tablet-portrait'

  // Phase 8.01.D wireframe-review fix: the Dashboard owns its own left
  // chrome (DashboardSidebar: LIBRARY / CONTEXT / SYSTEM / LEARN) and
  // a full-width canvas — it has no right detail-panel surface. Hide
  // the AppShell project Sidebar AND the detail panel only at
  // `/dashboard`. All other routes keep the three-panel shell exactly.
  const pathname = usePathname()
  const isDashboardRoute = pathname === '/dashboard'
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [detailWidth,  setDetailWidth]  = useState(DETAIL_DEFAULT)
  const [rightSlotContent, setRightSlotContent] = useState<ReactNode | null>(null)
  const [minWidthOverride, setMinWidthOverride] = useState<number | null>(null)
  const [organisationId, setOrganisationId] = useState<string | null>(null)
  const effectiveMin = Math.max(DETAIL_MIN, minWidthOverride ?? 0)
  const effectiveDetailWidth = Math.max(effectiveMin, Math.min(DETAIL_MAX, detailWidth))

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
    projectName: null,
    documentName: null,
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

  const setMinWidthOverrideStable = useCallback((px: number | null) => {
    setMinWidthOverride(px)
  }, [])

  return (
    <SidebarProjectContext.Provider value={{ state: sidebarProjectState, setProject, bumpRefresh }}>
    <RightSlotContext.Provider value={{ setContent: setRightSlotContent, setMinWidthOverride: setMinWidthOverrideStable }}>
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
        {/* Phase 8.01.F T-5 — At tablet-portrait, the left Sidebar and its
            resizer are hidden; the Sidebar lives in a slide-over instead,
            triggered by the TreeSummonButton in Header. Desktop +
            tablet-landscape keep the existing pinned layout exactly.

            Phase 8.01.D wireframe-review — At `/dashboard`, the AppShell
            project Sidebar is suppressed too: the Dashboard owns its own
            left chrome (LIBRARY / CONTEXT / SYSTEM / LEARN) with a
            different section shape, and stacking two sidebars eats >440px
            of canvas. All other routes keep the existing layout. */}
        {!isTabletPortrait && !isDashboardRoute && (
          <>
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
          </>
        )}

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

        {/* Phase 8.01.D wireframe-review — The dashboard has no right
            detail-panel surface; suppress the resizer + panel at
            `/dashboard` so the dashboard canvas spans the full width.
            All other routes preserve the right detail-panel exactly. */}
        {!isDashboardRoute && (
          <>
            <PanelResizer
              position="tree-detail"
              value={effectiveDetailWidth}
              onChange={updateDetail}
              min={effectiveMin}
              max={DETAIL_MAX}
            />

            <div
              data-shell="detail"
              aria-label="Detail panel"
              style={{
                width: `${effectiveDetailWidth}px`,
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
          </>
        )}
      </div>
      {/* V1.x-B.1.1 — persistent bottom-right status indicator. Fixed-position;
          non-blocking; visible from every screen (CS v2.10 §17.1). */}
      <AppShellStatusIndicator />
      {/* Phase 7 — bottom-right export progress chips. Multi-export stack
          per wireframe §05; subscribes to active export_jobs via Realtime. */}
      <ExportProgressStack />
      {/* Phase 8.01.F T-6 — Tree slide-over. Only renders contents when
          open (the internal SlideOver gates on the store's open state).
          Mounted at all viewports so the TreeSummonButton can toggle
          without remounting cost; the SlideOver itself returns null on
          desktop / tablet-landscape because the summon button is hidden
          there and the open state stays false. */}
      {isTabletPortrait && <TreeSlideOver sidebarWidth={sidebarWidth} />}
      </div>
    </RightSlotContext.Provider>
    </SidebarProjectContext.Provider>
  )
}
