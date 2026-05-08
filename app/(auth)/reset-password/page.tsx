'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setLoading(true)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (authError) { setError(authError.message); return }
    router.push('/dashboard')
  }

  return (
    <>
      <h1 style={{ fontSize: 'var(--text-xl)', color: 'var(--color-text-primary)', marginBottom: 'var(--space-6)', fontWeight: 500 }}>
        Set new password
      </h1>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>New password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            minLength={8}
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>Confirm new password</span>
          <input
            type="password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            style={inputStyle}
          />
        </label>
        {error && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)' }}>{error}</p>
        )}
        <button type="submit" disabled={loading} style={primaryButtonStyle}>
          {loading ? 'Saving…' : 'Set password'}
        </button>
      </form>
    </>
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
