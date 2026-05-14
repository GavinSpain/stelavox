/**
 * POST /api/scheduler/jobs/[jobId]/reschedule
 *
 * V1.x-B.1.1 — change agent_jobs.scheduled_at. Silent edit per
 * design record §12 (no system event surfaces). Director picks up
 * via get_scheduler_state on its next turn (V2 read tool — not yet
 * shipped; until then the queue read endpoint suffices for UI surfaces).
 *
 * Body: { scheduled_at: string | null } — ISO timestamp or null to
 * clear scheduled_at and revert to immediate dispatch.
 */

import 'server-only'

import { NextResponse, type NextRequest } from 'next/server'

import { apiError, isUuid } from '@/lib/director/route-helpers'
import { createClient } from '@/lib/supabase/server'

const TERMINAL = new Set(['completed', 'accepted', 'cancelled', 'failed', 'dismissed'])

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const { jobId } = await context.params
  if (!isUuid(jobId)) return apiError(400, 'invalid_uuid')

  let scheduledAt: string | null
  try {
    const body = (await req.json()) as { scheduled_at?: unknown }
    if (body.scheduled_at === null) {
      scheduledAt = null
    } else if (typeof body.scheduled_at === 'string') {
      const parsed = new Date(body.scheduled_at)
      if (isNaN(parsed.getTime())) return apiError(400, 'invalid_scheduled_at', 'must be ISO 8601')
      scheduledAt = parsed.toISOString()
    } else {
      return apiError(400, 'invalid_body', 'scheduled_at: string|null required')
    }
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
    return apiError(409, 'invalid_status', `cannot reschedule job in status "${job.status}"`)
  }

  const { error } = await supabase
    .from('agent_jobs')
    .update({ scheduled_at: scheduledAt })
    .eq('id', jobId)
  if (error) return apiError(500, 'reschedule_failed', error.message)

  return NextResponse.json({ job_id: jobId, scheduled_at: scheduledAt })
}
