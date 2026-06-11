import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/layout/AppShell'
import { QueryProvider } from './QueryProvider'
import { NodesPatcherMount } from '@/lib/queries/NodesPatcherMount'
import { ChannelGate } from '@/lib/realtime/ChannelGate'
import { RealtimeBadge } from '@/components/feedback/RealtimeBadge'
import { isPathTrialExempt, isTrialExpired } from '@/lib/billing/trialExpiry'

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

  // Phase 9.B — trial-expiry redirect. The (app)/* shell is gated for
  // trial orgs whose trial_expires_at has elapsed; the only authenticated
  // routes that stay reachable are /settings/plan* (so the user can
  // subscribe) and the /api/billing/* + /api/stripe/* paths (so the
  // subscribe button actually works). Path detection rides on the
  // x-pathname header that middleware.ts sets per request.
  if (orgId) {
    const { data: org } = await supabase
      .from('organisations')
      .select('plan, trial_expires_at')
      .eq('id', orgId)
      .maybeSingle()
    if (org && isTrialExpired(org)) {
      const pathname = (await headers()).get('x-pathname')
      if (!isPathTrialExempt(pathname)) {
        redirect('/settings/plan?reason=trial_expired')
      }
    }
  }

  // Phase 8.5b B.3 — TanStack Query provider wraps every authenticated
  // route. One persistent QueryClient per browser tab; default options
  // per Tier-A §3.2.
  //
  // Phase 8.5b B.3b — NodesPatcherMount subscribes to nodes-table
  // postgres_changes and patches the cache directly.
  //
  // Phase 8.5b B.5 — UserRealtimeChannel opens the SINGLE multiplexed
  // user channel (Tier-A §5.2). Per-component consumers subscribe via
  // useRealtimeTopic and receive demuxed events. RealtimeBadge surfaces
  // disconnect status.
  //
  // Phase 8.5b B.6 — ChannelGate wraps UserRealtimeChannel and unmounts
  // it after 10 min of `document.visibilityState='hidden'`. Background
  // tabs free their Supabase channel slot; the gate re-mounts on tab
  // return and TanStack's refetchOnReconnect catches active queries up.
  // See Tier-A §5.7.
  return (
    <QueryProvider>
      <ChannelGate userId={user.id} orgId={orgId} />
      <NodesPatcherMount orgId={orgId} />
      <AppShell userEmail={user.email ?? ''}>{children}</AppShell>
      <RealtimeBadge />
    </QueryProvider>
  )
}
