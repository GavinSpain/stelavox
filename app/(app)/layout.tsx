import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/AppShell'
import { QueryProvider } from './QueryProvider'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Phase 8.5b B.3 — TanStack Query provider wraps every authenticated
  // route. One persistent QueryClient per browser tab; default options
  // per Tier-A §3.2.
  return (
    <QueryProvider>
      <AppShell userEmail={user.email ?? ''}>{children}</AppShell>
    </QueryProvider>
  )
}
