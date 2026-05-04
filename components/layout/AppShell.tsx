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

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Header } from './Header'
import { Sidebar } from './Sidebar'
import { PanelResizer } from './PanelResizer'

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
  )
}
