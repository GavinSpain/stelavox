'use client'

// Phase 8.5b B.3 — Query error fallback.
//
// Rendered by data-fetching surfaces (NodeTree, NodeDetailPanel) when
// the associated useQuery enters error state. Shows the error message
// + a Retry button that invalidates the affected query, plus a placeholder
// "Report" button (V2 candidate; no-op in V1).
//
// Refs: docs/stelavox_document_load_architecture_v1_0.md §3.7
//       Inviolable #1 (lowest-noise bg, no verdigris on error surfaces)
//
// No new verdigris uses — Retry uses --color-text-primary, error border
// uses --color-error per Tier-A §3.7.

import type { ReactNode } from 'react'

interface QueryErrorFallbackProps {
  /** Error from the query (TanStack `error` field). */
  error: unknown
  /** Called when the user clicks Retry — usually queryClient.invalidateQueries. */
  onRetry: () => void
  /** Optional descriptive label rendered above the message. */
  label?: string
  /** Optional content to render below the buttons (e.g. metadata). */
  footer?: ReactNode
}

export function QueryErrorFallback({ error, onRetry, label, footer }: QueryErrorFallbackProps) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div
      data-testid="query-error-fallback"
      role="alert"
      style={{
        margin: 'var(--space-3)',
        padding: 'var(--space-4)',
        background: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-error)',
        borderRadius: 6,
        color: 'var(--color-text-primary)',
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      {label && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--color-error)',
            marginBottom: 6,
          }}
        >
          {label}
        </div>
      )}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.5,
          marginBottom: 12,
          color: 'var(--color-text-secondary)',
          wordBreak: 'break-word',
        }}
      >
        {message}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={onRetry}
          data-testid="query-error-retry"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-strong)',
            borderRadius: 4,
            padding: '5px 12px',
            color: 'var(--color-text-primary)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
        <button
          type="button"
          disabled
          title="Reporting will be wired in V2"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-border-default)',
            borderRadius: 4,
            padding: '5px 12px',
            color: 'var(--color-text-muted)',
            fontSize: 12,
            cursor: 'not-allowed',
          }}
        >
          Report
        </button>
      </div>
      {footer && (
        <div style={{ marginTop: 12, color: 'var(--color-text-muted)', fontSize: 11 }}>
          {footer}
        </div>
      )}
    </div>
  )
}
