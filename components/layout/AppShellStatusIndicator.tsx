'use client'

/**
 * V1.x-B.1.1 — AppShellStatusIndicator.
 *
 * Per Component Spec v2.10 §17.1 + design record §3 / §5.
 *
 * Persistent bottom-right corner indicator. Visible from every screen.
 * Non-blocking — fixed-position; never overlays user content. Click
 * opens a popover listing pending Director attention items grouped by
 * document with deep-link rows.
 *
 * B.1.1 surfaces: Director state badge (running jobs > 0 = "thinking"),
 * scheduler counters (running / queued briefs / active briefs), alert
 * dot (failed jobs in 24h window). Cost meter compact form is mounted
 * as a placeholder skeleton until V1.x-C.
 *
 * Realtime subscribes to agent_jobs + briefs to keep counts fresh.
 * First-paint hydrate via /api/status/pending-attention.
 *
 * Inviolable #2: NO verdigris use. Director-state badge uses
 * --color-text-secondary; alert dot uses attention-amber rgba; counters
 * use --color-text-primary at the right sizing.
 */

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { StatusIndicatorPopover } from './StatusIndicatorPopover'

interface PendingAttention {
  running_jobs: number
  queued_briefs: number
  active_briefs: number
  failed_jobs: number
  alerts: number
}

const POLL_FALLBACK_MS = 60_000  // safety-net poll if Realtime drops

export function AppShellStatusIndicator() {
  const [data, setData] = useState<PendingAttention | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/status/pending-attention', { cache: 'no-store' })
      if (res.ok) {
        const body = (await res.json()) as PendingAttention
        setData(body)
      }
    } catch {
      // Network error — keep last known state.
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // Realtime — agent_jobs + briefs change → refresh counts.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('app-shell-status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_jobs' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'briefs' }, () => void refresh())
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [refresh])

  // Safety-net poll in case Realtime drops mid-session.
  useEffect(() => {
    const id = setInterval(() => void refresh(), POLL_FALLBACK_MS)
    return () => clearInterval(id)
  }, [refresh])

  if (!data) {
    // No initial paint — keep the indicator silent until first hydrate.
    return null
  }

  const totalActive = data.running_jobs + data.active_briefs
  const queued = data.queued_briefs
  const hasAlert = data.alerts > 0
  const isQuiet = totalActive === 0 && queued === 0 && !hasAlert

  return (
    <>
      <button
        type="button"
        data-testid="app-shell-status-indicator"
        data-state={isQuiet ? 'quiet' : 'active'}
        data-running={data.running_jobs}
        data-queued={data.queued_briefs}
        data-active-briefs={data.active_briefs}
        data-alerts={data.alerts}
        aria-label={`Director status. ${data.running_jobs} running, ${data.queued_briefs} queued, ${data.alerts} alerts.`}
        onClick={() => setOpen((o) => !o)}
        style={{
          position: 'fixed',
          right: 24,
          bottom: 24,
          zIndex: 50,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-border-strong)',
          borderRadius: 999,
          padding: '8px 14px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 12,
          color: isQuiet ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}
      >
        <span data-testid="director-state-badge" data-state={totalActive > 0 ? 'thinking' : 'idle'} style={{ fontWeight: 500 }}>
          {totalActive > 0 ? 'Director' : 'Idle'}
        </span>
        {totalActive > 0 ? (
          <span data-testid="scheduler-counters" data-running={data.running_jobs} data-queued={data.queued_briefs} style={{ color: 'var(--color-text-secondary)' }}>
            {data.running_jobs} running{queued > 0 ? ` · ${queued} queued` : ''}
          </span>
        ) : queued > 0 ? (
          <span data-testid="scheduler-counters" data-queued={data.queued_briefs} style={{ color: 'var(--color-text-secondary)' }}>
            {queued} queued
          </span>
        ) : null}
        {hasAlert ? (
          <span
            data-testid="alert-dot"
            aria-label={`${data.alerts} alerts`}
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              borderRadius: 999,
              background: 'rgba(208, 153, 50, 0.9)',  // attention-amber
            }}
          />
        ) : null}
      </button>
      {open ? (
        <StatusIndicatorPopover counts={data} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}
