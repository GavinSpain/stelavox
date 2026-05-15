'use client'

// Spec: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.5
//       Director Architecture v2.0 §13 (Stop semantics)
//       Component Spec v2.11 §5.14 (StopButton — to be authored in B.2.4 consolidation)
//
// Mounts in the DirectorPanel header when an in-progress turn is active.
// Click → confirmation dialog with cascade preview (computed at click
// time via /api/scheduler/stop preflight; B.2.1 ships the simpler
// "Stop the Director?" copy and lets the Stop API recompute cascade on
// insert).
//
// Inviolable discipline: NO verdigris. Stop is destructive and uses the
// same destructive-token primary action as ConversationClearButton's
// confirm — `--color-text-primary` background, `--color-bg-base` text.
// Verdigris is reserved for affirmative-action triggers per Inviolable #2 use #7.

import { useState } from 'react'

interface StopButtonProps {
  turnId: string
  /** Called after a successful stop. */
  onStopped?: () => void
  /** Compact label variant for SchedulerPanel rows; default uses full label. */
  compact?: boolean
}

export function StopButton({ turnId, onStopped, compact = false }: StopButtonProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmStop() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/director/turns/${turnId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null
        setError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      setOpen(false)
      onStopped?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="director-turn-stop-button"
        onClick={() => setOpen(true)}
        title="Stop the Director"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-secondary)',
          padding: compact ? '3px 8px' : '4px 10px',
          fontSize: compact ? 10 : 11,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Stop
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-director-title"
          data-testid="director-turn-stop-dialog"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) setOpen(false)
          }}
        >
          <div
            style={{
              background: 'var(--color-bg-base)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 8,
              maxWidth: 420,
              padding: '18px 20px',
              fontFamily: 'var(--font-inter), Inter, sans-serif',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <h2
              id="stop-director-title"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                marginBottom: 10,
              }}
            >
              Stop the Director?
            </h2>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                fontWeight: 300,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.5,
                marginBottom: 16,
              }}
            >
              The current Director turn will be cancelled. Any queued iterations are stopped immediately;
              an in-flight iteration finishes its active LLM call and then exits.
            </p>

            {error ? (
              <div
                role="alert"
                style={{
                  padding: '8px 12px',
                  background: 'rgba(184,48,48,0.08)',
                  border: '1px solid rgba(184,48,48,0.25)',
                  borderRadius: 4,
                  fontSize: 12,
                  color: 'var(--color-text-primary)',
                  marginBottom: 12,
                }}
              >
                {error}
              </div>
            ) : null}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpen(false)}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-secondary)',
                  padding: '6px 14px',
                  fontSize: 12,
                  borderRadius: 4,
                  cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                Keep going
              </button>
              <button
                type="button"
                data-testid="director-turn-stop-confirm"
                disabled={submitting}
                onClick={() => void confirmStop()}
                style={{
                  background: 'var(--color-text-primary)',
                  color: 'var(--color-bg-base)',
                  border: 'none',
                  padding: '6px 14px',
                  fontSize: 12,
                  fontWeight: 500,
                  borderRadius: 4,
                  cursor: submitting ? 'wait' : 'pointer',
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
