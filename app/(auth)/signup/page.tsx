'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const supabase = createClient()
    const { data, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name }, emailRedirectTo: `${location.origin}/auth/callback` },
    })
    setLoading(false)
    if (authError) { setError(authError.message); return }
    if (data.session) {
      router.push('/dashboard')
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-3)' }}>
          Check your email
        </h1>
        <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
          We sent a confirmation link to <strong style={{ color: 'var(--color-text-primary)' }}>{email}</strong>.
        </p>
      </div>
    )
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-6)', fontWeight: 500 }}>
        Create your account
      </h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            autoComplete="name"
            style={inputStyle}
          />
        </Field>
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
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
        </Field>
        <Field label="Confirm password">
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
        </Field>
        {error && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</p>
        )}
        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p style={{ marginTop: 'var(--space-5)', fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
        Already have an account?{' '}
        <Link href="/login" style={{ color: 'var(--color-text-primary)' }}>Sign in</Link>
      </p>
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
  marginTop: 'var(--space-2)',
}
