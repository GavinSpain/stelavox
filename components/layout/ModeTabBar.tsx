'use client'

// Spec: stelavox_component_specification_v2_7.md §2.5 (ModeTabBar)
//       stelavox_phase5b_build_checklist_v1_0.md §3.14 T-14.1
//
// Edit / Director / Focus tabs in the Header. Reads the active mode
// from ModeContext (lifted to AppShell). Focus is a transient overlay
// (not a stored mode), so its tab remains disabled here — entering
// Focus is a separate gesture handled in components/focus/.
//
// Per Component Spec §2.5: Inviolable #2 — `--color-accent` MUST NOT
// appear in this file. Active tab uses --color-text-primary +
// --color-bg-surface; the Director-running pulse dot uses
// --color-agent-running, NOT --color-accent.

import { useCallback, useEffect, useState } from 'react'
import { useMode, type AppMode } from './ModeContext'
import { useSidebarProject } from './AppShell'
// Phase 8.5b B.5 — createClient + ensureRealtimeAuth no longer needed;
// the multiplexed user channel handles auth + subscribe once for the
// whole tab.
import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'

// Phase 8.8 — the dead "Focus" tab was removed. Focus Mode is a
// leaf-context overlay, not a route-level mode; entry stays at the
// working FocusModeButton inside NodeDetailPanel. The tab here had
// been hardcoded `selectable: false` with a no-op click handler — a
// dead affordance that looked clickable and wasn't.
const TABS: ReadonlyArray<{ id: AppMode; label: string; selectable: boolean }> = [
  { id: 'edit',     label: 'Edit',     selectable: true },
  { id: 'director', label: 'Director', selectable: true },
]

export function ModeTabBar() {
  const { mode, setMode, enabled } = useMode()
  const { state: { documentId } } = useSidebarProject()
  const hasPending = useDirectorPendingForDocument(documentId)

  // SU-J12-6 (Mars-drive 2026-05-09): on non-document routes
  // (dashboard, project list, settings) the tab bar previously
  // rendered as disabled-grey but still visible, presenting a dead
  // affordance. Hide entirely when no document client is mounted.
  if (!enabled) return null

  // Phase 8.01 wireframe-alignment round 2: pill grouper per
  // 02_edit_mode_v2_iter3.html .mode-tabs — --color-bg-surface bg, 1px
  // --color-border-default border, 5px radius, 2px internal padding.
  // Active tab gets --color-bg-selected (not --color-bg-surface — the
  // grouper IS bg-surface so the active state needs a different tonal
  // step).
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
        const active = enabled && tab.selectable && tab.id === mode
        const disabled = !enabled || !tab.selectable
        return (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => {
              if (disabled) return
              setMode(tab.id)
            }}
            style={{
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              border: 'none',
              background: active ? 'var(--color-bg-selected)' : 'transparent',
              color: active
                ? 'var(--color-text-primary)'
                : 'var(--color-text-muted)',
              fontWeight: 500,
              fontSize: 12,
              padding: '5px 14px',
              borderRadius: 3,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled && !tab.selectable ? 0.5 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition:
                'background var(--duration-fast) var(--easing-smooth), ' +
                'color var(--duration-fast) var(--easing-smooth)',
            }}
          >
            {tab.label}
            {tab.id === 'director' && hasPending && tab.id !== mode ? (
              <span
                data-testid="director-tab-badge"
                aria-label="Director has pending attention"
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: 999,
                  background: 'var(--color-info)',  // wireframe uses running-bright blue
                  boxShadow: '0 0 4px rgba(77,143,214,0.6)',
                  verticalAlign: 'middle',
                }}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * V1.x-B.1.1 — small hook polling /api/status/document/[id]/pending-director.
 * Refreshes on conversation_messages + briefs realtime events for the
 * current document. Kept inline to ModeTabBar to avoid a one-call lib
 * file (single-call surface) — promote to lib/hooks if a second consumer
 * appears.
 */
function useDirectorPendingForDocument(documentId: string | null): boolean {
  const [pending, setPending] = useState(false)

  // Define refresh outside the effect so the realtime hooks can close
  // over a stable reference for cleanup. The conditional disable
  // when documentId is null keeps the API call from firing.
  const refresh = useCallback(async () => {
    if (!documentId) return
    try {
      const res = await fetch(`/api/status/document/${documentId}/pending-director`, { cache: 'no-store' })
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

  // Phase 8.5b B.5 — Realtime via the multiplexed user channel demuxer.
  // conversation_messages is not org-scoped at the channel level so the
  // demuxer sees all events for the user's joined surfaces; we accept
  // them all because the refresh handler is idempotent and the API
  // call is cheap. briefs is org-scoped at the channel; we filter by
  // documentId here to ignore other docs' brief changes.
  useRealtimeTopic('conversation_messages', () => void refresh())
  useRealtimeTopic(
    'briefs',
    () => void refresh(),
    (payload) => {
      const row = (payload.new && Object.keys(payload.new).length > 0 ? payload.new : payload.old) as { document_id?: string }
      return row.document_id === documentId
    },
  )

  return pending
}
