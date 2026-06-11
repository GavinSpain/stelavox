'use client'

/**
 * Phase 9.B work package B — Manage Subscription button.
 *
 * POSTs to /api/billing/portal and redirects to the returned Stripe
 * Customer Portal URL. The Portal handles cancel / switch plan / update
 * payment method / view invoices — V1 spec lock is hosted Portal, no
 * custom UI for any of that.
 *
 * Shown only when the org already has a stripe_customer_id (i.e. has
 * gone through Checkout at least once). The parent decides visibility.
 */

import { useState } from 'react'

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
        setError(body.message ?? body.error ?? 'Could not open Customer Portal')
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
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        data-testid="manage-subscription-button"
        style={{
          background: 'transparent',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border-default)',
          borderRadius: 4,
          padding: '6px 14px',
          fontSize: 12,
          fontWeight: 400,
          fontFamily: 'var(--font-inter), Inter, sans-serif',
          cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Opening Portal…' : 'Manage subscription'}
      </button>
      {error ? (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--color-status-review)',
            fontFamily: 'var(--font-inter), Inter, sans-serif',
          }}
          data-testid="manage-subscription-error"
        >
          {error}
        </div>
      ) : null}
    </div>
  )
}
