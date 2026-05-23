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
//   3. Settings footer    (bottom; collapse chevron lives here too)
//
// IMPORTANT — separation of concerns: the Sidebar does NOT contain the
// node tree. The node tree is the centre panel of AppShell.
//
// Inviolable #2: `--color-accent` MUST NOT appear in this file.
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

const STORAGE_KEY            = 'stelavox_sidebar_state'
const SECTIONS_EXPANDED_KEY  = 'stelavox_sidebar_context_expanded'

interface SidebarProps {
  /**
   * Optional prop overrides — useful for tests + the rare case where a
   * page wants to render the Sidebar with explicit names. The default
   * pulls names from SidebarProjectContext (populated by DocumentClient /
   * ProjectSidebarSetup); previously these props were the only source
   * and the context never carried names, so the slot showed "—".
   */
  projectName?: string
  documentName?: string
  width?: number
}

interface ContextNodeSummary {
  id:        string
  name:      string | null
  node_type: string
  scope:     'project' | 'document'
}

export function Sidebar({ projectName: projectNameProp, documentName: documentNameProp, width = 220 }: SidebarProps) {
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
  const documentName = documentNameProp ?? state.documentName ?? undefined

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
      }}
    >
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
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 'var(--space-2)',
              }}
            >
              Project
            </div>
            <div
              style={{
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text-primary)',
                fontWeight: 500,
              }}
            >
              {projectName ?? '—'}
            </div>
            {documentName && (
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-secondary)',
                  marginTop: 'var(--space-1)',
                }}
              >
                {documentName}
              </div>
            )}
            {/* Scheduler link — only when a document is loaded. Gives
               the user a way to see queued/active Briefs + workflows
               + agent jobs. The route was orphaned before this. */}
            {projectId && documentId && (
              <div style={{ marginTop: 'var(--space-3)' }}>
                <Link
                  href={`/projects/${projectId}/documents/${documentId}/scheduler`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-secondary)',
                    textDecoration: 'none',
                    padding: '4px 0',
                  }}
                >
                  <span aria-hidden="true">⧗</span>
                  Scheduler
                </Link>
              </div>
            )}
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
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
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

      {/* Footer — settings link + collapse chevron */}
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderTop: '1px solid var(--color-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: collapsed ? 'center' : 'space-between',
        }}
      >
        {!collapsed && (
          <a
            href="/settings"
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-secondary)',
              textDecoration: 'none',
            }}
          >
            Settings
          </a>
        )}
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
