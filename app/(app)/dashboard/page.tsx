// Phase 8.01.D T-10 — Dashboard page rewrite.
//
// Server component fetches all the data the populated + first-time
// dashboard shapes need, then hands off to DashboardClient which owns
// the SampleNovelImportModal state.

import { createClient } from '@/lib/supabase/server'
import { getResumeWritingTarget } from '@/lib/dashboard/resumeWriting'
import { getProjectAggregates } from '@/lib/dashboard/projectAggregates'
import { getQuickStartCompletion } from '@/lib/dashboard/quickStartCompletion'
import type { SidebarCounts } from '@/components/dashboard/DashboardSidebar'
import { DashboardClient } from './DashboardClient'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // The (app) layout already gates this, but defend.
    return null
  }
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organisation_id: string }>()
  if (!membership) {
    // Defensive — H-03 trigger should have created the org. Render the
    // first-time path empty rather than crashing.
    return (
      <DashboardClient
        shape="first-time"
        resumeTarget={null}
        aggregates={[]}
        sidebarCounts={{ allProjects: 0, recent: 0, characters: 0, locations: 0, themes: 0 }}
        quickStart={{
          signedIn: true,
          hasProject: false,
          hasBeatWithProse: false,
          hasTriedDirector: false,
          hasCompletedExport: false,
        }}
      />
    )
  }
  const orgId = membership.organisation_id

  const [aggregates, resumeTarget, quickStart, contextCounts, recentCount] = await Promise.all([
    getProjectAggregates(supabase, orgId),
    getResumeWritingTarget(supabase, orgId),
    getQuickStartCompletion(supabase, orgId),
    getContextCounts(supabase, orgId),
    getRecentProjectCount(supabase, orgId),
  ])

  const sidebarCounts: SidebarCounts = {
    allProjects: aggregates.length,
    recent: recentCount,
    ...contextCounts,
  }

  const shape: 'populated' | 'first-time' = aggregates.length === 0 ? 'first-time' : 'populated'
  return (
    <DashboardClient
      shape={shape}
      resumeTarget={resumeTarget}
      aggregates={aggregates}
      sidebarCounts={sidebarCounts}
      quickStart={quickStart}
    />
  )
}

async function getContextCounts(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string) {
  const [chars, locs, themes] = await Promise.all([
    supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('node_category', 'context')
      .eq('node_type', 'character'),
    supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('node_category', 'context')
      .eq('node_type', 'location'),
    supabase
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .eq('organisation_id', orgId)
      .eq('node_category', 'context')
      .eq('node_type', 'theme'),
  ])
  return {
    characters: chars.count ?? 0,
    locations: locs.count ?? 0,
    themes: themes.count ?? 0,
  }
}

async function getRecentProjectCount(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', orgId)
    .gte('updated_at', sevenDaysAgo)
  return count ?? 0
}
