/**
 * GET /api/status/pending-attention
 *
 * V1.x-B.1.1 — first-render hydrate for AppShellStatusIndicator.
 * Returns global counts across all documents the caller can see (RLS):
 *   - running_jobs: agent_jobs in 'running' status
 *   - queued_briefs: briefs in 'queued' status
 *   - active_briefs: briefs in 'active' status
 *   - failed_jobs: agent_jobs in 'failed' status (recent-window)
 *   - alerts: count of items needing user attention (failed jobs +
 *     proposals awaiting approval — for B.1.1 this is just failed
 *     jobs; proposal-awaiting-approval is per-document via the
 *     companion endpoint).
 *
 * Realtime is the live update path (subscribed to agent_jobs / briefs);
 * this endpoint is the first-paint hydrate so the indicator doesn't
 * pop in.
 */

import 'server-only'

import { NextResponse } from 'next/server'

import { apiError } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  // Recent-window for failed jobs — anything in the last 24 hours.
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // RLS scopes each count to the caller's organisations automatically.
  const [
    { count: runningJobs },
    { count: queuedBriefs },
    { count: activeBriefs },
    { count: failedJobs },
  ] = await Promise.all([
    supabase.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    supabase.from('briefs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    supabase.from('briefs').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('agent_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed').gte('created_at', dayAgo),
  ])

  return NextResponse.json({
    running_jobs: runningJobs ?? 0,
    queued_briefs: queuedBriefs ?? 0,
    active_briefs: activeBriefs ?? 0,
    failed_jobs: failedJobs ?? 0,
    alerts: failedJobs ?? 0,
  })
}
