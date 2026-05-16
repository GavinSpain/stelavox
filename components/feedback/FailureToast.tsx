'use client'

/**
 * FailureToast — Class A (retry) + Class C (capacity) surface.
 *
 * Source: docs/wireframes/wireframe_failure_mode_ux_v1.html §02.
 * Spec: Component Spec §17.13 (V1.x-F).
 *
 * Anchors bottom-right of the app shell (callers provide their own
 * positioning container; this component renders the single toast).
 * Auto-dismiss is the caller's responsibility — the toast itself only
 * renders + exposes onDismiss.
 *
 * Tones (D1 / D2 locked decisions):
 *   - Class A — --color-info left border; appears on 2nd retry onward
 *     so transient self-healing errors stay silent.
 *   - Class C — --color-status-review left border; appears only when
 *     back-off >= failure.class_c_min_pause_seconds (default 15s).
 *
 * Inviolables: Inter only; no verdigris.
 */

interface FailureToastProps {
  classKind: 'A' | 'C'
  title: string
  message: string
  onDismiss?: () => void
}

const ICON: Record<FailureToastProps['classKind'], string> = {
  A: '⟳',
  C: '⏸',
}

export function FailureToast({ classKind, title, message, onDismiss }: FailureToastProps) {
  const accent = classKind === 'A' ? 'var(--color-info)' : 'var(--color-status-review)'
  return (
    <div
      data-testid="failure-toast"
      data-class={classKind}
      role="status"
      aria-live="polite"
      style={{
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-subtle)',
        borderLeft: `3px solid ${accent}`,
        borderRadius: '4px',
        padding: 'var(--space-2) var(--space-3)',
        fontSize: '12px',
        color: 'var(--color-text-secondary)',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--space-2)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        minWidth: '280px',
        maxWidth: '360px',
      }}
    >
      <span
        aria-hidden
        style={{
          width: '16px',
          height: '16px',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: accent,
        }}
      >
        {ICON[classKind]}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
          {title}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{message}</div>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        data-testid="failure-toast-dismiss"
        style={{
          fontSize: '14px',
          color: 'var(--color-text-tertiary)',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  )
}
