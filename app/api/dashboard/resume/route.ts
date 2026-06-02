// Phase 8.01.D T-2 — GET /api/dashboard/resume
//
// Returns the most-recently-edited leaf beat with prose across the
// caller's org. Powers the ResumeWritingHero on the populated dashboard.
//
// Returns { target: ResumeWritingTarget | null }.
// Auth: requires a signed-in user; org resolved from organisation_members.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getResumeWritingTarget } from '@/lib/dashboard/resumeWriting'

export async function GET(): Promise<Response> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  const { data: membership } = await supabase
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle<{ organisation_id: string }>()
  if (!membership) {
    return NextResponse.json({ target: null })
  }
  const target = await getResumeWritingTarget(supabase, membership.organisation_id)
  return NextResponse.json({ target })
}
