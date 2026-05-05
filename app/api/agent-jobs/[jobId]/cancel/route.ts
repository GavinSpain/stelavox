// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.6 (POST cancel)
//       stelavox_phase5_test_plan_v1_0.md TC-A-28 / TC-A-29 / TC-A-30
//       stelavox_phase5_build_checklist_v1_0.md T-9.2

import { NextRequest, NextResponse } from 'next/server'

import { err } from '@/lib/api/errors'
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

  const { data: updated, error } = await supabase
    .from('agent_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .select('*')
    .single()
  if (error || !updated) {
    console.error('[agent-jobs cancel] update error', error)
    return err.internal()
  }

  return NextResponse.json(updated)
}
