'use client'

// Spec: stelavox_component_specification_v2_10.md §17.10
//       Director Architecture v2.0 §12.5 (user-initiated Clear)
//
// Mounts in the DirectorPanel header. Confirmation dialog with the exact
// copy specified in v2.10 §17.10. On confirm, POSTs to the clear endpoint
// — which hard-deletes conversation_messages but leaves the Brief and
// document untouched.
//
// Inviolable discipline: no verdigris use here. This is a destructive
// action; affordance is text-button with a confirmation dialog, not a
// primary-action treatment.

import { useState } from 'react'

interface ConversationClearButtonProps {
  conversationId: string
  onCleared?: () => void
}

export function ConversationClearButton({
  conversationId,
  onCleared,
}: ConversationClearButtonProps) {
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmClear() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/director/conversation/${conversationId}/clear`,
        { method: 'POST' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
        setError(body?.message ?? body?.error ?? `Failed (${res.status})`)
        return
      }
      setOpen(false)
      onCleared?.()
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
        data-testid="conversation-clear-button"
        onClick={() => setOpen(true)}
        title="Clear recent conversation"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-border-subtle)',
          color: 'var(--color-text-secondary)',
          padding: '4px 10px',
          fontSize: 11,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          borderRadius: 4,
          cursor: 'pointer',
        }}
      >
        Clear conversation
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="clear-conversation-title"
          data-testid="conversation-clear-dialog"
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
              id="clear-conversation-title"
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 500,
                color: 'var(--color-text-primary)',
                marginBottom: 10,
              }}
            >
              Clear conversation?
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
              Clearing will discard recent conversation but keep your project Brief and document.
              Continue?
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
                Cancel
              </button>
              <button
                type="button"
                data-testid="conversation-clear-confirm"
                disabled={submitting}
                onClick={() => void confirmClear()}
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
                {submitting ? 'Clearing…' : 'Clear'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
