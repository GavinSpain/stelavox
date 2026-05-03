'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  return (
    <button
      onClick={handleSignOut}
      style={{
        background: 'none',
        border: '1px solid var(--color-border-default)',
        borderRadius: '4px',
        padding: 'var(--space-1) var(--space-3)',
        color: 'var(--color-text-secondary)',
        fontSize: 'var(--text-sm)',
        cursor: 'pointer',
      }}
    >
      Sign out
    </button>
  )
}
