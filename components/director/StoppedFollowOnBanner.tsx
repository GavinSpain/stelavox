'use client'

/**
 * V1.x-D.3 — StoppedFollowOnBanner.
 *
 * Source: Component Spec §17.9 · wireframe_stop_refinement_v1.html §03.
 *
 * Renders in the DirectorPanel conversation thread when the most recent
 * director_turn has status='cancelled' and was stopped by the user.
 * Surfaces three follow-on choices:
 *   - Resume (continues from persisted iteration state)
 *   - Cancel (destructive; abandons remaining iterations)
 *   - View what was done (browse the completed iteration outputs)
 *
 * V1.x-D MVP scope: Resume + Cancel are wired to the existing endpoints
 * (POST /api/director/conversation/[id]/resume + scheduler cancel).
 * View is the simplest affordance — scrolls the conversation thread to
 * the completed iteration outputs (the PlanCard render already shows
 * them in step-status format).
 *
 * Once the user picks an action OR dismisses, the banner clears and
 * subsequent visits to the conversation don't re-show it. Persistence:
 * the banner reads turnRow.status; when the user "resumes" the turn
 * goes back to 'in_progress' and the banner stops rendering; when the
 * user "cancels" the turn stays 'cancelled' but a localStorage entry
 * (`turn-followon-dismissed:<turnId>`) hides the banner.
 *
 * Inviolable #2: no verdigris. Resume uses a small --color-accent-hover
 * glyph but card background is neutral --color-bg-elevated; Cancel uses
 * destructive token border; View is neutral.
 */

import { useState } from 'react'

interface StoppedFollowOnBannerProps {
  turnId: string
  conversationId: string
  iterationCount: number
  onResumed?: () => void
  onCancelled?: () => void
  onView?: () => void
}

function dismissKey(turnId: string): string {
  return `turn-followon-dismissed:${turnId}`
}

function isBannerDismissed(turnId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(dismissKey(turnId)) !== null
  } catch {
    return false
  }
}

function markBannerDismissed(turnId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(dismissKey(turnId), new Date().toISOString())
  } catch {
    // Quota / privacy mode — silently ignore.
  }
}

export function StoppedFollowOnBanner({
  turnId,
  conversationId,
  iterationCount,
  onResumed,
  onCancelled,
  onView,
}: StoppedFollowOnBannerProps) {
  const [submitting, setSubmitting] = useState<'resume' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hidden, setHidden] = useState(() => isBannerDismissed(turnId))

  if (hidden) return null

  async function resume() {
    setSubmitting('resume')
    setError(null)
    try {
      const res = await fetch(`/api/director/conversation/${conversationId}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null
        setError(body?.message ?? body?.error ?? `Resume failed (${res.status})`)
        return
      }
      // Banner clears via the parent re-fetching turn state (resume
      // moves status back to in_progress). Also dismiss locally so
      // it doesn't flash back during the round-trip.
      markBannerDismissed(turnId)
      setHidden(true)
      onResumed?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSubmitting(null)
    }
  }

  function dismissAfterCancel() {
    markBannerDismissed(turnId)
    setHidden(true)
    onCancelled?.()
  }

  return (
    <div
      data-testid="director-turn-followon-banner"
      role="region"
      aria-label="Director stopped — choose what to do next"
      style={{
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border-default)',
        borderLeft: '3px solid var(--color-warning)',
        borderRadius: 6,
        padding: '14px 16px',
        marginBottom: 14,
        fontFamily: 'var(--font-inter), Inter, sans-serif',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 4 }}>
        Director stopped
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
        {iterationCount === 0
          ? 'Halted before any iterations completed. State preserved.'
          : `${iterationCount} iteration${iterationCount === 1 ? '' : 's'} completed before stop. State preserved.`}
      </div>

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
            marginTop: 10,
          }}
        >
          {error}
        </div>
      ) : null}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
          marginTop: 12,
        }}
      >
        <button
          type="button"
          data-testid="director-turn-resume"
          disabled={submitting !== null}
          onClick={() => void resume()}
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 6,
            padding: '12px 14px',
            cursor: submitting ? 'wait' : 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ color: 'var(--color-accent-hover)' }}>▶</span>
            {submitting === 'resume' ? 'Resuming…' : 'Resume'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Continue from the persisted state.
          </div>
        </button>

        <button
          type="button"
          data-testid="director-turn-cancel-followon"
          disabled={submitting !== null}
          onClick={() => dismissAfterCancel()}
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid rgba(184,48,48,0.3)',
            borderRadius: 6,
            padding: '12px 14px',
            cursor: submitting ? 'wait' : 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'rgba(184,48,48,0.95)',
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            ✕ Cancel
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Abandon the remaining iterations. Completed work stays.
          </div>
        </button>

        <button
          type="button"
          data-testid="director-turn-view"
          disabled={submitting !== null}
          onClick={() => onView?.()}
          style={{
            background: 'var(--color-bg-elevated)',
            border: '1px solid var(--color-border-default)',
            borderRadius: 6,
            padding: '12px 14px',
            cursor: 'pointer',
            textAlign: 'left',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              marginBottom: 4,
            }}
          >
            ⊟ View what was done
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
            Browse the completed iterations before deciding.
          </div>
        </button>
      </div>
    </div>
  )
}
