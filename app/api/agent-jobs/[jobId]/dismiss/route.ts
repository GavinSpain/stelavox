// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.8 (POST dismiss)
//       stelavox_phase5_test_plan_v1_0.md TC-A-31 / TC-A-32
//       stelavox_phase5_build_checklist_v1_0.md T-9.4

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
import { transitionAgentJob } from '@/lib/orchestration'
import { createClient } from '@/lib/supabase/server'
import { isValidUuid } from '@/lib/validation/uuid'

interface Context { params: Promise<{ jobId: string }> }

export async function POST(_request: NextRequest, { params }: Context) {
  const { jobId } = await params
  if (!isValidUuid(jobId)) return err.invalidUuid()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  const { data: job } = await supabase
    .from('agent_jobs')
    .select('id, state')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return err.notFound()

  // Idempotent on already-dismissed or already-failed (failure is already
  // terminal; the UI just needs to clear the surface).
  if (job.state === 'dismissed' || job.state === 'failed') {
    const { data } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
    return NextResponse.json(data)
  }

  // The canonical Dismiss path: awaiting_accept → dismissed.
  if (job.state !== 'awaiting_accept') {
    return err.agentJobAlreadyTerminal(job.state)
  }

  // Apollo Phase 3: delegate to orchestration.
  const result = await transitionAgentJob(supabase, jobId, 'author_dismiss', 'dismissed')
  if (!result.ok) {
    console.error('[agent-jobs dismiss] transition failed', { jobId, error: result.error, message: result.message })
    return err.internal()
  }

  const { data: updated } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
  return NextResponse.json(updated)
}
