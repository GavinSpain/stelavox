/**
 * POST /api/scheduler/jobs/[jobId]/intent
 *
 * V1.x-B.1.1 — change agent_jobs.execution_intent. Silent edit.
 * B.1.1 admits: 'immediate' ↔ 'scheduled' ↔ 'parked'. 'batched_24h'
 * is reserved for B.2 (Anthropic Batch API integration); accepting
 * the value here would let users elect a route that doesn't yet exist.
 *
 * Body: { execution_intent: 'immediate' | 'scheduled' | 'parked' }.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

const B11_INTENTS = new Set(['immediate', 'scheduled', 'parked'])
const TERMINAL = new Set(['completed', 'accepted', 'cancelled', 'failed', 'dismissed'])

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params
  if (!isUuid(jobId)) return apiError(400, 'invalid_uuid')

  let intent: string
  try {
    const body = (await req.json()) as { execution_intent?: unknown }
    if (typeof body.execution_intent !== 'string') {
      return apiError(400, 'invalid_body', 'execution_intent: string required')
    }
    if (!B11_INTENTS.has(body.execution_intent)) {
      return apiError(400, 'invalid_intent', `execution_intent must be one of: immediate, scheduled, parked (batched_24h ships in B.2)`)
    }
    intent = body.execution_intent
  } catch {
    return apiError(400, 'invalid_body', 'JSON body required')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return apiError(401, 'unauthenticated')

  const { data: job } = await supabase
    .from('agent_jobs')
    .select('id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return apiError(404, 'job_not_found')
  if (TERMINAL.has(job.status)) {
    return apiError(409, 'invalid_status', `cannot change intent on job in status "${job.status}"`)
  }

  const { error } = await supabase
    .from('agent_jobs')
    .update({ execution_intent: intent })
    .eq('id', jobId)
  if (error) return apiError(500, 'intent_update_failed', error.message)

  return NextResponse.json({ job_id: jobId, execution_intent: intent })
}
