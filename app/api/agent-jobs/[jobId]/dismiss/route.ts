// Spec: stelavox_phase5_api_contract_v1_0.md v1.2 §3.8 (POST dismiss)
//       stelavox_phase5_test_plan_v1_0.md TC-A-31 / TC-A-32
//       stelavox_phase5_build_checklist_v1_0.md T-9.4

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

  // Idempotent on already-dismissed
  if (job.status === 'dismissed') {
    const { data } = await supabase.from('agent_jobs').select('*').eq('id', jobId).single()
    return NextResponse.json(data)
  }

  if (job.status !== 'completed') {
    return err.agentJobAlreadyTerminal(job.status)
  }

  const { data: updated, error } = await supabase
    .from('agent_jobs')
    .update({ status: 'dismissed', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .select('*')
    .single()
  if (error || !updated) return err.internal()
  return NextResponse.json(updated)
}
