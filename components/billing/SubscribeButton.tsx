'use client'

/**
 * Phase 9.B work package B — Subscribe button for the PlanPanel tier cards.
 *
 * POSTs to /api/billing/checkout with the plan slug; on success
 * redirects window.location to the Stripe Checkout URL. On 503
 * (stripe_not_configured) surfaces an inline note rather than throwing.
 *
 * Used inside PlanPanel.TierCard. Disabled when the tier is the current
 * plan or the trial plan (trial users go to trial_expires_at first; the
 * Subscribe action only makes sense for paid tiers).
 */

import { useState } from 'react'

interface Props {
  plan: 'writer' | 'author' | 'pro' | 'byok_solo'
  cadence: 'monthly' | 'yearly'
  disabled?: boolean
}

export function SubscribeButton({ plan, cadence, disabled }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, cadence }),
      })
      if (res.status === 503) {
        setError('Subscriptions not yet enabled. Check back shortly.')
        setLoading(false)
        return
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        setError(body.message ?? body.error ?? 'Could not start Checkout')
        setLoading(false)
        return
      }
      const { url } = (await res.json()) as { url: string }
      window.location.href = url
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || loading}
        data-testid={`subscribe-button-${plan}`}
        style={{
          background: disabled
            ? 'var(--color-bg-elevated)'
            : 'var(--color-accent)',
          color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-on-accent)',
          border: 'none',
          borderRadius: 4,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          cursor: disabled || loading ? 'default' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {loading ? 'Opening Checkout…' : 'Subscribe'}
      </button>
      {error ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--color-status-review)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
          data-testid={`subscribe-error-${plan}`}
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}
