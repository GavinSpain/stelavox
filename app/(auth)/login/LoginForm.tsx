'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [magicLink, setMagicLink] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(searchParams.get('error'))
  const [magicDone, setMagicDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const supabase = createClient()

    if (magicLink) {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      })
      setLoading(false)
      if (authError) { setError(authError.message); return }
      setMagicDone(true)
      return
    }

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (authError) { setError('Invalid email or password.'); return }
    router.push('/dashboard')
  }

  if (magicDone) {
    return (
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>
          Check your email
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
          We sent a magic link to <strong style={{ color: 'var(--color-text-primary)' }}>{email}</strong>.
        </p>
      </div>
    )
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-6)', fontWeight: 500 }}>
        Sign in
      </h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="Email">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoComplete="email"
            style={inputStyle}
          />
        </Field>
        {!magicLink && (
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              style={inputStyle}
            />
          </Field>
        )}
        {error && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</p>
        )}
        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? 'Signing in…' : magicLink ? 'Send magic link' : 'Sign in'}
        </button>
      </form>
      <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => { setMagicLink(m => !m); setError(null) }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}
        >
          {magicLink ? 'Use password instead' : 'Sign in with magic link'}
        </button>
        {!magicLink && (
          <Link href="/forgot-password" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
            Forgot password?
          </Link>
        )}
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
          No account?{' '}
          <Link href="/signup" style={{ color: 'var(--color-text-primary)', textDecoration: 'underline' }}>Create one</Link>
        </p>
      </div>
    </>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // Nesting the input inside the <label> establishes the implicit
  // label/input association, satisfying screen readers + Playwright's
  // getByLabel resolver (SU-J1-2).
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{label}</span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-bg-base)',
  border: '1px solid var(--color-border-default)',
  borderRadius: '4px',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-base)',
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: 'var(--space-2) var(--space-3)',
  background: 'var(--color-text-primary)',
  color: 'var(--color-bg-base)',
  border: 'none',
  borderRadius: '4px',
  fontSize: 'var(--text-base)',
  fontWeight: 500,
  cursor: 'pointer',
}
