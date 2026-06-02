'use client'

// Phase 8.01.D T-4 — Needs Attention strip.
//
// Spec: Component Spec v2.21 §18.4 Dashboard populated shape, right of
//       the Resume hero. Surfaces Director / scheduler / budget signals
//       drawn from the existing V1.x-B.1.1 /api/status/pending-attention
//       endpoint.
//
// Inviolable #2: no verdigris. Attention-amber + info-blue dots.
// Empty state: the parent component should hide this strip entirely
// when no items are present (don't render an empty stub).

import { useEffect, useState } from 'react'

interface PendingAttentionResponse {
  running_jobs: number
  queued_briefs: number
  active_briefs: number
  failed_jobs: number
}

interface AttentionItem {
  testid: string
  dotKind: 'amber' | 'info'
  text: string
}

function deriveItems(data: PendingAttentionResponse): AttentionItem[] {
  const items: AttentionItem[] = []
  if (data.active_briefs > 0) {
    items.push({
      testid: 'attn-active-briefs',
      dotKind: 'amber',
      text: `${data.active_briefs} active Brief${data.active_briefs === 1 ? '' : 's'} in progress`,
    })
  }
  if (data.failed_jobs > 0) {
    items.push({
      testid: 'attn-failed-jobs',
      dotKind: 'amber',
      text: `${data.failed_jobs} failed agent job${data.failed_jobs === 1 ? '' : 's'} (last 24h)`,
    })
  }
  if (data.running_jobs > 0) {
    items.push({
      testid: 'attn-running-jobs',
      dotKind: 'info',
      text: `${data.running_jobs} agent job${data.running_jobs === 1 ? '' : 's'} running`,
    })
  }
  if (data.queued_briefs > 0) {
    items.push({
      testid: 'attn-queued-briefs',
      dotKind: 'info',
      text: `${data.queued_briefs} Brief${data.queued_briefs === 1 ? '' : 's'} queued`,
    })
  }
  return items
}

const DOT_COLORS = {
  amber: 'var(--color-status-review)',
  info: 'var(--color-info)',
}

export function NeedsAttentionStrip() {
  const [items, setItems] = useState<AttentionItem[] | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/status/pending-attention', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: PendingAttentionResponse | null) => {
        if (cancelled || !body) return
        setItems(deriveItems(body))
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (items === null) return null // loading: render nothing rather than skeleton noise
  if (items.length === 0) return null // empty state: hide strip per spec

  return (
    <div
      data-testid="needs-attention-strip"
      style={{
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 8,
        padding: '16px 18px',
      }}
    >
      <div
        style={{
          fontFamily: 'ui-monospace, "JetBrains Mono", SFMono-Regular, Menlo, monospace',
          fontSize: 10.5,
          letterSpacing: '0.06em',
          color: 'var(--color-text-muted)',
          marginBottom: 10,
        }}
      >
        NEEDS ATTENTION
      </div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {items.map((item) => (
          <li
            key={item.testid}
            data-testid={item.testid}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 0',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              fontSize: 12,
              color: 'var(--color-text-primary)',
              borderBottom: '1px solid var(--color-border-subtle)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: DOT_COLORS[item.dotKind],
                flexShrink: 0,
              }}
            />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
