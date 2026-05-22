// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.6 (POST cancel)
//       stelavox_phase5_test_plan_v1_0.md TC-A-28 / TC-A-29 / TC-A-30
//       stelavox_phase5_build_checklist_v1_0.md T-9.2

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
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return err.notFound()

  // Idempotent on already-cancelled
  if (job.status === 'cancelled') {
    const { data } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
    return NextResponse.json(data)
  }

  if (job.status !== 'pending' && job.status !== 'running') {
    return err.agentJobNotInProgress()
  }

  // Apollo Phase 3: delegate to orchestration. The DB trigger will refuse
  // any illegal transition; the auto-derive trigger keeps legacy columns
  // in sync. This closes G-06 — pre-fix this route wrote `status` only,
  // leaving `queue_status` stale and check_node_writable indefinitely
  // flagging the node as in-progress.
  const result = await transitionAgentJob(supabase, jobId, 'cancel_or_cascade', 'cancelled', {
    errorMessage: 'user_cancelled',
  })
  if (!result.ok) {
    console.error('[agent-jobs cancel] transition failed', { jobId, error: result.error, message: result.message })
    return err.internal()
  }

  const { data: updated } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
  return NextResponse.json(updated)
}
