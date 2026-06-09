'use client'

/**
 * Director status indicator — Header pill.
 *
 * Phase 8 nav refactor (2026-06-08): relocated from a fixed-position
 * floating pill (bottom-left) into the Header right cluster (left of
 * the Search chip + UserMenu).
 *
 * - Permanent chrome location: visible from every page without floating
 *   over content.
 * - Quiet state: muted "Idle" pill with a subtle dot. Active state:
 *   running count + alert dot.
 * - Click opens the StatusIndicatorPopover anchored to the top-right
 *   (under the header), listing pending Director-attention items with
 *   deep-link rows.
 *
 * Realtime subscribes to agent_jobs + briefs to keep counts fresh.
 * First-paint hydrate via /api/status/pending-attention.
 *
 * Inviolable #2: NO verdigris use. Director-state label uses
 * --color-text-secondary; alert dot uses attention-amber rgba; counters
 * use --color-text-primary at the right sizing.
 */

import { useCallback, useEffect, useState } from 'react'

import { useRealtimeTopic } from '@/lib/realtime/useRealtimeTopic'
import { StatusIndicatorPopover } from './StatusIndicatorPopover'

type CostMeterPayload =
  | { byok_enabled: true; plan: string; tokens_input: number; tokens_output: number }
  | {
      byok_enabled: false
      plan: string
      usage_credits: number
      allocation_credits: number | null
      days_remaining: number | null
    }
  | null

interface PendingAttention {
  running_jobs: number
  queued_briefs: number
  active_briefs: number
  failed_jobs: number
  alerts: number
  primary_org_id?: string | null
  cost_meter?: CostMeterPayload
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

  // Realtime via the multiplexed user channel demuxer (Tier-A §5.2).
  useRealtimeTopic('agent_jobs', () => void refresh())
  useRealtimeTopic('briefs', () => void refresh())

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
          // Header pill — inline in the right cluster. NO position:fixed.
          background: isQuiet ? 'transparent' : 'var(--color-bg-surface)',
          border: `1px solid ${isQuiet ? 'var(--color-border-subtle)' : 'var(--color-border-default)'}`,
          borderRadius: 999,
          padding: '5px 12px',
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          fontSize: 11.5,
          color: isQuiet ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          height: 28,
          lineHeight: 1,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: 999,
            background: totalActive > 0 ? 'var(--color-agent-running)' : 'var(--color-text-muted)',
          }}
        />
        <span data-testid="director-state-badge" data-state={totalActive > 0 ? 'thinking' : 'idle'} style={{ fontWeight: 500 }}>
          {totalActive > 0 ? 'Director' : 'Idle'}
        </span>
        {totalActive > 0 ? (
          <span data-testid="scheduler-counters" data-running={data.running_jobs} data-queued={data.queued_briefs} style={{ color: 'var(--color-text-secondary)' }}>
            {data.running_jobs}{queued > 0 ? ` · ${queued}` : ''}
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
              width: 7,
              height: 7,
              borderRadius: 999,
              background: 'rgba(208, 153, 50, 0.95)',  // attention-amber
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
