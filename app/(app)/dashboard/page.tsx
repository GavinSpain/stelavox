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

  // Phase 8 nav cleanup: getContextCounts + getRecentProjectCount
  // deleted alongside the LIBRARY + CONTEXT sidebar sections that
  // consumed them. SidebarCounts shape kept for back-compat with
  // DashboardClient prop signature; the fields are unused by the
  // pruned sidebar.
  const [aggregates, resumeTarget, quickStart] = await Promise.all([
    getProjectAggregates(supabase, orgId),
    getResumeWritingTarget(supabase, orgId),
    getQuickStartCompletion(supabase, orgId),
  ])

  const sidebarCounts: SidebarCounts = {
    allProjects: aggregates.length,
    recent: 0,
    characters: 0,
    locations: 0,
    themes: 0,
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
