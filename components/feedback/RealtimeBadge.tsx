'use client'

// Phase 8.5b B.5 — Realtime channel status badge.
//
// Subscribes to the user-channel status (lib/realtime/useUserChannel.ts)
// and renders a small fixed-position pill indicating connection state.
// Hidden when 'connected'.
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.7 §5.5
//
// No new verdigris uses — Inviolable #2 preserved. Uses existing
// --color-status-review for "Reconnecting…" and --color-error for
// "Disconnected".

import { useEffect, useState } from 'react'

import {
  subscribeChannelStatus,
  type RealtimeChannelStatus,
} from '@/lib/realtime/useUserChannel'

export function RealtimeBadge(): React.ReactElement | null {
  const [status, setStatus] = useState<RealtimeChannelStatus>('connecting')

  useEffect(() => {
    return subscribeChannelStatus((s) => setStatus(s))
  }, [])

  if (status === 'connected') return null

  const label =
    status === 'connecting' ? 'Connecting…'
    : status === 'reconnecting' ? 'Reconnecting…'
    : 'Disconnected'

  const borderColor =
    status === 'failed' ? 'var(--color-error)' : 'var(--color-status-review)'

  return (
    <div
      data-testid="realtime-badge"
      data-status={status}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 16,
        left: 16,
        zIndex: 100,
        padding: '6px 12px',
        background: 'var(--color-bg-elevated)',
        border: `1px solid ${borderColor}`,
        borderRadius: 999,
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
        fontSize: 11,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: borderColor,
          animation: status === 'failed' ? 'none' : 'realtime-badge-pulse 1.4s ease-in-out infinite',
        }}
      />
      {label}
      <style jsx>{`
        @keyframes realtime-badge-pulse {
          0%   { opacity: 0.4; }
          50%  { opacity: 1;   }
          100% { opacity: 0.4; }
        }
        @media (prefers-reduced-motion: reduce) {
          span { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
