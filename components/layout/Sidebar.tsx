'use client'

// Spec: stelavox_component_specification_v2_5.md §2.3 (Sidebar)
//       stelavox_brand_identity_v2_0.md §8.2 (Edit Mode three-panel layout)
//       stelavox_phase2_build_checklist_v1_0.md v1.1 §3.2 T-2.3
//       stelavox_phase4_build_checklist_v1_0.md §3.4 T-4.1, T-4.3
//
// Sidebar — left panel of AppShell. 220px expanded, 48px collapsed.
// Three vertical sections per Component Spec §2.3:
//   1. Project navigation (top, auto-height)
//   2. Context library    (middle, flex:1, scrollable)
//                          ↑ Phase 4 populates: six SidebarContextSections
//                            (Characters / Locations / Organisations /
//                            Themes / Plot Threads / Worlds).
//   3. Collapse footer    (bottom; collapse chevron only.
//                          The legacy "Settings" link was removed
//                          2026-06-09 — Header UserMenu is the canonical
//                          Settings entry.)
//
// IMPORTANT — separation of concerns: the Sidebar does NOT contain the
// node tree. The node tree is the centre panel of AppShell.
//
// Inviolable #2: `--color-accent` is used in this file under two
// existing categories, each rationalised by precedent in the v1.46
// audit notes:
//   - The right-edge gradient (subtle verdigris vertical texture)
//     reuses brand-mark family (use #1) as a decorative texture
//     analogous to the YoursTile dot precedent.
//   - The active-item left border reuses use #9 (active-node left
//     border) — same visual treatment, analogous semantic (where the
//     author currently is in the workspace navigation). No Inviolable
//     broadening, per the mentioned-node precedent.
//
// Phase 4 data flow:
//   - The active project is set by pages via `useSidebarProject()` (in
//     AppShell). When projectId is set, the Sidebar fetches
//     /api/projects/[id]/context-nodes and renders the six sections.
//   - On row click, the Sidebar invokes `onSelectContextNode(id)` from
//     the context. Pages with a detail-panel mechanism (the document
//     page) wire this to their selectedNodeId state.
//   - The [+] button on each section opens a ContextCreateModal pre-set
//     to that type. On success the Sidebar refetches.
//   - `refreshKey` from the context lets other surfaces (e.g. the
//     ContextLinker's Picker → quick-create) trigger a refetch.

import Link from 'next/link'
import { useEffect, useState, useCallback } from 'react'
import {
  CONTEXT_NODE_TYPES_V1,
  type ContextNodeType,
} from '@/lib/context/types'
import { getContextLabel } from '@/lib/context/labels'
import { getContextIcon } from '@/lib/context/icons'
import { SidebarContextSection } from './SidebarContextSection'
import { ContextCreateModal } from '@/components/context/ContextCreateModal'
import { useSidebarProject } from './AppShell'
import { useProjectDocuments } from '@/lib/queries/useProjectDocuments'

const STORAGE_KEY            = 'stelavox_sidebar_state'
const SECTIONS_EXPANDED_KEY  = 'stelavox_sidebar_context_expanded'

interface SidebarProps {
  /**
   * Optional prop override — useful for tests + the rare case where a
   * page wants to render the Sidebar with an explicit project name.
   * The default pulls the name from SidebarProjectContext (populated by
   * DocumentClient / ProjectSidebarSetup).
   *
   * Phase 8 nav cleanup follow-up (2026-06-09): the legacy `documentName`
   * prop was dropped — the PROJECT slot now renders the project's full
   * document list (via useProjectDocuments) with active-state highlight
   * derived from the active documentId in context. There is no longer
   * a single string "current document" to override.
   */
  projectName?: string
  width?: number
}

interface ContextNodeSummary {
  id:        string
  name:      string | null
  node_type: string
  scope:     'project' | 'document'
}

export function Sidebar({ projectName: projectNameProp, width = 220 }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [expandedSections, setExpandedSections] =
    useState<Record<ContextNodeType, boolean>>(() => Object.fromEntries(
      CONTEXT_NODE_TYPES_V1.map(t => [t, false]),
    ) as Record<ContextNodeType, boolean>)
  const [contextNodes, setContextNodes] = useState<ContextNodeSummary[]>([])
  const [modalType, setModalType] = useState<ContextNodeType | null>(null)

  const { state, bumpRefresh } = useSidebarProject()
  const { projectId, documentId, onSelectContextNode, refreshKey } = state
  // Prop wins (test override); fall back to context.
  const projectName = projectNameProp ?? state.projectName ?? undefined

  // Phase 8 nav cleanup follow-up (2026-06-09) — fetch the project's
  // active documents so the PROJECT slot can render the whole list
  // (indented under the project name) with the active document
  // highlighted. Provides one-click switching between siblings.
  // staleTime=5min in the hook; layout-remount-on-doc-switch refetches
  // naturally on navigation. See lib/queries/useProjectDocuments.ts.
  const { data: projectDocuments } = useProjectDocuments(projectId)

  // Hydrate sidebar collapse state. setState-in-effect is the standard
  // SSR-safe pattern for client-only storage; same exception as Phase 2's
  // Sidebar / AppShell.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    if (localStorage.getItem(STORAGE_KEY) === 'collapsed') setCollapsed(true)
    const raw = localStorage.getItem(SECTIONS_EXPANDED_KEY)
    if (raw) {
      try {
        const stored = JSON.parse(raw) as Record<string, boolean>
        const next = { ...expandedSections }
        for (const t of CONTEXT_NODE_TYPES_V1) {
          if (typeof stored[t] === 'boolean') next[t] = stored[t]
        }
        setExpandedSections(next)
      } catch { /* ignore */ }
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clear cached context-nodes only on project/document SWITCH (not on
  // refresh-key bumps). SU-J14-2 (Techno-thriller drive 2026-05-09): the
  // earlier fix (SU-J12-5) cleared the array on every effect run including
  // refresh-key bumps. After the user created a sibling-category context
  // node, the refresh-key bump fired this effect → the list cleared →
  // the freshly-just-created row vanished from the sidebar until the
  // next reload. Splitting the clear into its own project/doc-switch-only
  // effect keeps the cross-document leak fix without dropping in-flight
  // create results.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setContextNodes([])
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [projectId, documentId])

  // Fetch context-nodes whenever projectId, documentId, or refreshKey
  // changes. The fetch's response replaces `contextNodes` atomically;
  // there is no intermediate empty state on a refresh-key bump alone.
  useEffect(() => {
    if (!projectId) return
    const controller = new AbortController()
    const url = documentId
      ? `/api/projects/${projectId}/context-nodes?limit=200&document_id=${documentId}`
      : `/api/projects/${projectId}/context-nodes?limit=200`
    fetch(url, { signal: controller.signal })
      .then(async r => {
        if (!r.ok) return
        const body = await r.json() as { context_nodes: ContextNodeSummary[] }
        setContextNodes(body.context_nodes ?? [])
      })
      .catch(e => {
        if (e?.name === 'AbortError') return
        // Non-200s and network errors fail silently — the Sidebar shows
        // the empty-state in each section. Errors are logged in the
        // browser dev tools by the Network tab.
      })
    return () => controller.abort()
  }, [projectId, documentId, refreshKey])

  // Bucket fetched nodes by type for the section components.
  const nodesByType = (() => {
    const out = Object.fromEntries(
      CONTEXT_NODE_TYPES_V1.map(t => [t, [] as ContextNodeSummary[]]),
    ) as Record<ContextNodeType, ContextNodeSummary[]>
    for (const n of contextNodes) {
      if ((CONTEXT_NODE_TYPES_V1 as readonly string[]).includes(n.node_type)) {
        out[n.node_type as ContextNodeType].push(n)
      }
    }
    return out
  })()

  const toggleSidebar = useCallback(() => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
  }, [collapsed])

  const toggleSection = useCallback((t: ContextNodeType) => {
    setExpandedSections(prev => {
      const next = { ...prev, [t]: !prev[t] }
      try {
        localStorage.setItem(SECTIONS_EXPANDED_KEY, JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  }, [])

  const handleSelect = useCallback((nodeId: string) => {
    onSelectContextNode?.(nodeId)
  }, [onSelectContextNode])

  return (
    <aside
      style={{
        width: collapsed ? '48px' : `${width}px`,
        flexShrink: 0,
        background: 'var(--color-bg-surface)',
        borderRight: '1px solid var(--color-border-subtle)',
        transition: 'width var(--duration-normal) var(--easing-smooth)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Subtle verdigris edge gradient — brand-mark family (use #1
          precedent: decorative-but-restrained brand texture). Sits at
          the right edge between the sidebar and the tree pane. */}
      {!collapsed && (
        <div
          aria-hidden
          data-testid="sidebar-edge-gradient"
          style={{
            position: 'absolute',
            right: 0,
            top: 48,
            bottom: 48,
            width: 1,
            background:
              'linear-gradient(180deg, transparent 0%, rgba(90,168,122,0.55) 20%, rgba(90,168,122,0.55) 80%, transparent 100%)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Project navigation — top, auto-height */}
      <div
        style={{
          padding: 'var(--space-4)',
          borderBottom: '1px solid var(--color-border-subtle)',
          minHeight: '60px',
        }}
      >
        {!collapsed && (
          <>
            <div
              data-testid="sidebar-section-label-project"
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: 9,
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.38em',
                marginBottom: 'var(--space-2)',
              }}
            >
              Project
            </div>
            {/* Phase 8 nav refactor: project name is a Link to the
               project page, giving authors an explicit back-path from
               document → project (previously plain text; only escape
               was Wordmark → /dashboard).

               Phase 8 nav cleanup follow-up (2026-06-09): the project
               name now sits above an indented list of the project's
               active documents. Each row is a Link; the row whose id
               matches the active documentId gets a neutral highlight
               (bg-elevated + primary text). This turns the slot into
               a real navigation surface for sibling-document switching
               instead of a flat current-doc label. */}
            {projectId ? (
              <Link
                href={`/projects/${projectId}`}
                data-testid="sidebar-project-name-link"
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 500,
                  textDecoration: 'none',
                  display: 'block',
                }}
              >
                {projectName ?? '—'}
              </Link>
            ) : (
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 500,
                }}
              >
                {projectName ?? '—'}
              </div>
            )}
            {projectId && projectDocuments && projectDocuments.length > 0 ? (
              <ul
                data-testid="sidebar-project-documents-list"
                style={{
                  listStyle: 'none',
                  margin: 'var(--space-2) 0 0',
                  padding: 0,
                }}
              >
                {projectDocuments.map((doc) => {
                  const isActive = doc.id === documentId
                  return (
                    <li key={doc.id} style={{ margin: 0 }}>
                      <Link
                        href={`/projects/${projectId}/documents/${doc.id}`}
                        data-testid="sidebar-project-document-row"
                        data-document-id={doc.id}
                        data-active={isActive ? 'true' : 'false'}
                        style={{
                          display: 'block',
                          // Inviolable #2: no verdigris. Active state
                          // uses neutral bg-elevated + primary text;
                          // inactive uses secondary text.
                          fontSize: 'var(--text-sm)',
                          color: isActive
                            ? 'var(--color-text-primary)'
                            : 'var(--color-text-secondary)',
                          fontWeight: isActive ? 500 : 400,
                          background: isActive ? 'var(--color-bg-elevated)' : 'transparent',
                          padding: '4px 8px',
                          // Indent under the project name to make the
                          // parent / child relationship visible.
                          marginLeft: 'var(--space-3)',
                          borderRadius: 3,
                          textDecoration: 'none',
                          // Truncate long names rather than wrapping
                          // and breaking the slot's vertical rhythm.
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        // Fall through to plain client-nav unless this
                        // is the current doc — clicking the current
                        // doc should be a no-op rather than a wasteful
                        // re-mount.
                        onClick={isActive ? (e) => e.preventDefault() : undefined}
                      >
                        {doc.name}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : null}
            {/* Phase 8 nav refactor: Scheduler link removed — Scheduler
               is now a peer mode in the ModeTabBar (Edit · Director ·
               Scheduler) at the top of the document layout. */}
          </>
        )}
      </div>

      {/* Context library — Phase 4 sections */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-3) var(--space-2)',
        }}
      >
        {!collapsed && (
          <>
            <div
              data-testid="sidebar-section-label-context"
              style={{
                fontFamily: 'var(--font-inter), Inter, sans-serif',
                fontSize: 9,
                fontWeight: 600,
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.38em',
                padding: '0 var(--space-2) var(--space-2)',
              }}
            >
              Context library
            </div>
            {!projectId ? (
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-muted)',
                  padding: '4px var(--space-2)',
                  fontStyle: 'italic',
                }}
              >
                Open a project to see its context library.
              </div>
            ) : (
              CONTEXT_NODE_TYPES_V1.map(t => (
                <SidebarContextSection
                  key={t}
                  type={t}
                  label={getContextLabel(t, true)}
                  Icon={getContextIcon(t)}
                  expanded={expandedSections[t]}
                  nodes={nodesByType[t]}
                  onToggle={() => toggleSection(t)}
                  onCreateClick={() => setModalType(t)}
                  onSelect={handleSelect}
                />
              ))
            )}
          </>
        )}
      </div>

      {/* Footer — collapse chevron only.
          Phase 8 nav cleanup follow-up (2026-06-09): the "Settings" link
          was removed in favour of the Header UserMenu (avatar dropdown)
          as the single canonical entry point. Settings is global chrome
          and never belonged in the project sidebar — the legacy footer
          link also produced a jarring return path (Settings page → ←
          Dashboard, not back to the project). */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'flex-end',
        }}
      >
        <button
          type="button"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-text-muted)',
            padding: 'var(--space-1)',
            fontSize: 'var(--text-base)',
            lineHeight: 1,
          }}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* ContextCreateModal — opened by the [+] buttons. */}
      {modalType !== null && projectId && (
        <ContextCreateModal
          open
          defaultType={modalType}
          projectId={projectId}
          documentId={documentId}
          onClose={() => setModalType(null)}
          onCreated={() => {
            setModalType(null)
            bumpRefresh()
          }}
        />
      )}
    </aside>
  )
}
