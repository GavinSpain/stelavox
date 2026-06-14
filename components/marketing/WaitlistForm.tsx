'use client'

/**
 * WaitlistForm — the pre-launch hero CTA (marketing.signup_mode = 'waitlist').
 *
 * Email field + "Join the waitlist" → POST /api/waitlist. On success swaps to
 * a confirmation line; dedupe returns alreadyOnList so a repeat sign-up reads
 * "You're already on the list." No auth.
 */

import { useState } from 'react'

import styles from './landing.module.css'

type State = 'idle' | 'submitting' | 'done' | 'error'

export function WaitlistForm() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'submitting') return
    setState('submitting')
    setMessage('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: 'landing' }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        alreadyOnList?: boolean
        error?: string
      }
      if (res.ok && body.ok) {
        setState('done')
        setMessage(
          body.alreadyOnList
            ? "You're already in the founding queue — we'll be in touch before we open."
            : "You're in. We'll send your founding offer before we open.",
        )
        return
      }
      setState('error')
      if (body.error === 'invalid_email') setMessage('That email doesn’t look right — try again.')
      else if (body.error === 'rate_limited') setMessage('Hold on a moment and try again.')
      else setMessage('Something went wrong — please try again.')
    } catch {
      setState('error')
      setMessage('Network error — please try again.')
    }
  }

  if (state === 'done') {
    return (
      <div className={styles.ctaRow}>
        <p className={styles.ctaSuccess} role="status">
          ✓ {message}
        </p>
      </div>
    )
  }

  return (
    <>
      <form className={styles.ctaForm} onSubmit={handleSubmit} noValidate>
        <label htmlFor="waitlist-email" className="sr-only" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
          Email address
        </label>
        <input
          id="waitlist-email"
          className={styles.ctaInput}
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button
          type="submit"
          className={styles.btnPrimary}
          disabled={state === 'submitting'}
        >
          {state === 'submitting' ? 'Claiming…' : 'Claim founding access'}
        </button>
      </form>
      {state === 'error' && (
        <p className={styles.ctaError} role="alert">
          {message}
        </p>
      )}
    </>
  )
}
