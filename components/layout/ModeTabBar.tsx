'use client'

// Phase 8 nav refactor: ModeTabBar is now URL-driven.
//
// Each tab is a Next.js <Link> to its mode's URL. The active tab is
// derived from the current pathname via useMode(). Mode-switch clicks
// produce real navigations — browser back/forward works, URLs are
// shareable, refresh preserves mode.
//
// Tabs: Edit · Director · Scheduler. Self-hides on non-document routes.
//
// Per Component Spec §2.5 + Inviolable #2: `--color-accent` MUST NOT
// appear in this file. Active tab uses --color-text-primary +
// --color-bg-selected. Pending-attention dots use --color-info (Director)
// or --color-agent-running (Scheduler when jobs are in flight).

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { useMode, type AppMode } from './ModeContext'
import { useSidebarProject } from './AppShell'
import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'

interface TabDef {
  id: AppMode
  label: string
  /** Sub-path appended to the document base URL. Empty for the default
   *  (Edit) mode. */
  subpath: '' | 'director' | 'scheduler'
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'edit', label: 'Edit', subpath: '' },
  { id: 'director', label: 'Director', subpath: 'director' },
  { id: 'scheduler', label: 'Scheduler', subpath: 'scheduler' },
]

export function ModeTabBar() {
  const { mode, enabled } = useMode()
  const { state: { projectId, documentId } } = useSidebarProject()
  const directorPending = useDirectorPendingForDocument(documentId)

  // SU-J12-6: on non-document routes (dashboard, project list, settings)
  // the bar previously rendered as disabled-grey but still visible,
  // presenting a dead affordance. Hide entirely when no document
  // layout is mounted.
  if (!enabled || !projectId || !documentId) return null

  const base = `/projects/${projectId}/documents/${documentId}`

  return (
    <div
      role="tablist"
      data-testid="mode-tab-bar"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        background: 'var(--color-bg-surface)',
        border: '1px solid var(--color-border-default)',
        padding: 2,
        borderRadius: 5,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === mode
        const href = tab.subpath === '' ? base : `${base}/${tab.subpath}`
        return (
          <Link
            key={tab.id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            href={href}
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              textDecoration: 'none',
              background: active ? 'var(--color-bg-selected)' : 'transparent',
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
              fontWeight: 500,
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 3,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition:
                'background var(--duration-fast) var(--easing-smooth), ' +
                'color var(--duration-fast) var(--easing-smooth)',
            }}
          >
            {tab.label}
            {tab.id === 'director' && directorPending && !active ? (
              <span
                data-testid="director-tab-badge"
                aria-label="Director has pending attention"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--color-info)',
                  boxShadow: '0 0 4px rgba(77,143,214,0.6)',
                  verticalAlign: 'middle',
                }}
              />
            ) : null}
          </Link>
        )
      })}
    </div>
  )
}

/**
 * V1.x-B.1.1 — small hook polling /api/status/document/[id]/pending-director.
 * Refreshes on conversation_messages + briefs realtime events for the
 * current document.
 */
function useDirectorPendingForDocument(documentId: string | null): boolean {
  const [pending, setPending] = useState(false)

  const refresh = useCallback(async () => {
    if (!documentId) return
    try {
      const res = await fetch(`/api/status/document/${documentId}/pending-director`, {
        cache: 'no-store',
      })
      if (res.ok) {
        const body = (await res.json()) as { has_pending?: boolean }
        setPending(!!body.has_pending)
      }
    } catch {
      // network error — keep last known
    }
  }, [documentId])

  useEffect(() => {
    if (!documentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPending(false)
      return
    }
    void refresh()
  }, [documentId, refresh])

  useRealtimeTopic('conversation_messages', () => void refresh())
  useRealtimeTopic(
    'briefs',
    () => void refresh(),
    (payload) => {
      const row =
        payload.new && Object.keys(payload.new).length > 0
          ? (payload.new as { document_id?: string })
          : (payload.old as { document_id?: string })
      return row.document_id === documentId
    },
  )

  return pending
}
