import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/AppShell'
import { QueryProvider } from './QueryProvider'
import { NodesPatcherMount } from '@/lib/queries/NodesPatcherMount'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Resolve the user's primary org so the Realtime patcher can scope
  // its postgres_changes filter. .maybeSingle() honours H-01 (zero
  // rows is a legitimate post-signup state pre-org-trigger).
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()
  const orgId = membership?.organisation_id ?? null

  // Phase 8.5b B.3 — TanStack Query provider wraps every authenticated
  // route. One persistent QueryClient per browser tab; default options
  // per Tier-A §3.2.
  //
  // Phase 8.5b B.3b — NodesPatcherMount subscribes to nodes-table
  // postgres_changes and patches the cache directly. Replaces the
  // per-component invalidate-then-refetch pattern; B.5 absorbs into
  // the multiplexed user channel.
  return (
    <QueryProvider>
      <NodesPatcherMount orgId={orgId} />
      <AppShell userEmail={user.email ?? ''}>{children}</AppShell>
    </QueryProvider>
  )
}
