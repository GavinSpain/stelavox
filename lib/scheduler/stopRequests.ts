import 'server-only'

/**
 * V1.x-B.2.1 — stop_requests helpers.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.5 + M-108.
 *
 * Two operational concerns:
 *   1. INSERT a stop_request (called by the API routes).
 *   2. Compute the cascade-preview count for a target before insertion
 *      (so the user sees "Stopping this workflow will cancel 7 queued
 *      steps" before they confirm).
 *
 * The dispatcher (lib/scheduler/dispatcher.ts) does the actual cascade
 * execution at the next tick — it cancels queued tickets and signals
 * in-flight runners to abort cooperatively.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import type { StopCascadeSummary } from '@/lib/director/types'

export interface InsertStopRequestInput {
  organisationId: string
  requestedByUserId: string
  targetKind: 'director_turn' | 'workflow' | 'brief'
  targetId: string
  reason?: string
}

export interface InsertStopRequestResult {
  stopRequestId: string
  cascade: StopCascadeSummary
}

/**
 * Compute cascade preview WITHOUT inserting the stop_request — for the
 * confirmation dialog. Counts queued + in-flight (dispatched/running)
 * agent_jobs that the cascade would cover.
 */
export async function computeStopCascade(
  targetKind: 'director_turn' | 'workflow' | 'brief',
  targetId: string,
): Promise<StopCascadeSummary> {
  const supabase = createServiceRoleClient()

  let inFlight = 0
  let queued = 0

  if (targetKind === 'director_turn') {
    const { count: inFlightCount } = await supabase
      .from('agent_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('director_turn_id', targetId)
      .in('queue_status', ['dispatched', 'running'])
    const { count: queuedCount } = await supabase
      .from('agent_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('director_turn_id', targetId)
      .eq('queue_status', 'queued')
    inFlight = inFlightCount ?? 0
    queued = queuedCount ?? 0
  } else if (targetKind === 'workflow') {
    // Find agent_jobs whose triggered_by is a workflow_step in the
    // target workflow. workflow_steps.agent_job_id is the back-link.
    const { data: steps } = await supabase
      .from('workflow_steps')
      .select('agent_job_id')
      .eq('workflow_id', targetId)
    const jobIds = (steps ?? [])
      .map((s) => s.agent_job_id as string | null)
      .filter((x): x is string => Boolean(x))
    if (jobIds.length > 0) {
      const { count: inFlightCount } = await supabase
        .from('agent_jobs')
        .select('id', { count: 'exact', head: true })
        .in('id', jobIds)
        .in('queue_status', ['dispatched', 'running'])
      const { count: queuedCount } = await supabase
        .from('agent_jobs')
        .select('id', { count: 'exact', head: true })
        .in('id', jobIds)
        .eq('queue_status', 'queued')
      inFlight = inFlightCount ?? 0
      queued = queuedCount ?? 0
    }
  } else if (targetKind === 'brief') {
    // brief → brief_stages → workflows → workflow_steps → agent_jobs.
    const { data: stages } = await supabase
      .from('brief_stages')
      .select('workflow_id')
      .eq('brief_id', targetId)
    const workflowIds = (stages ?? [])
      .map((s) => s.workflow_id as string | null)
      .filter((x): x is string => Boolean(x))
    if (workflowIds.length > 0) {
      const { data: steps } = await supabase
        .from('workflow_steps')
        .select('agent_job_id')
        .in('workflow_id', workflowIds)
      const jobIds = (steps ?? [])
        .map((s) => s.agent_job_id as string | null)
        .filter((x): x is string => Boolean(x))
      if (jobIds.length > 0) {
        const { count: inFlightCount } = await supabase
          .from('agent_jobs')
          .select('id', { count: 'exact', head: true })
          .in('id', jobIds)
          .in('queue_status', ['dispatched', 'running'])
        const { count: queuedCount } = await supabase
          .from('agent_jobs')
          .select('id', { count: 'exact', head: true })
          .in('id', jobIds)
          .eq('queue_status', 'queued')
        inFlight = inFlightCount ?? 0
        queued = queuedCount ?? 0
      }
    }
  }

  return {
    in_flight_count: inFlight,
    queued_count: queued,
    total: inFlight + queued,
  }
}

/**
 * INSERT a stop_request and return the row id + cascade summary.
 * Caller (API route) is responsible for verifying user identity + org
 * membership before calling.
 */
export async function insertStopRequest(
  input: InsertStopRequestInput,
): Promise<InsertStopRequestResult> {
  const supabase = createServiceRoleClient()

  // Compute cascade preview at insert time so it's recorded on the row
  // for forensics. The dispatcher recomputes at execution time (the
  // numbers may differ slightly if more tickets complete in between).
  const cascade = await computeStopCascade(input.targetKind, input.targetId)

  const { data, error } = await supabase
    .from('stop_requests')
    .insert({
      organisation_id: input.organisationId,
      requested_by: input.requestedByUserId,
      target_kind: input.targetKind,
      target_id: input.targetId,
      reason: input.reason ?? null,
      cascade_count: cascade.total,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`insertStopRequest failed: ${error?.message ?? 'no row returned'}`)
  }

  // Immediately mark queued tickets as cancelled. The dispatcher's
  // notStopRequested check will catch any new ones; we eagerly mark
  // existing ones so the UI updates promptly.
  await cancelQueuedTicketsForStop(input.targetKind, input.targetId)

  return {
    stopRequestId: data.id,
    cascade,
  }
}

/**
 * Mark queued tickets (queue_status='queued') as cancelled when a Stop
 * request is filed. In-flight tickets (dispatched/running) are left to
 * the runner's cooperative-abort path.
 *
 * M-205: now routes through transitionAgentJob (queued → cancelled via
 * 'cancel_or_cascade' event) rather than a direct UPDATE that bypassed
 * the state machine. Pre-Apollo the direct UPDATE wrote a (failed,
 * cancelled) tuple that contradicted the new single-state-column model;
 * the auto_derive trigger normalised those rows to (failed, failed),
 * which broke the test assertions.
 */
async function cancelQueuedTicketsForStop(
  targetKind: 'director_turn' | 'workflow' | 'brief',
  targetId: string,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const { transitionAgentJob } = await import('@/lib/orchestration')

  async function cancelOne(jobId: string): Promise<void> {
    await transitionAgentJob(supabase, jobId, 'cancel_or_cascade', 'cancelled', {
      errorMessage: 'cancelled_by_stop_request',
      failureClass: 'B',
    })
  }

  async function jobIdsForTurn(): Promise<string[]> {
    const { data } = await supabase
      .from('agent_jobs')
      .select('id')
      .eq('director_turn_id', targetId)
      .eq('queue_status', 'queued')
    return (data ?? []).map((r) => r.id as string)
  }

  async function jobIdsForWorkflow(): Promise<string[]> {
    const { data: steps } = await supabase
      .from('workflow_steps')
      .select('agent_job_id')
      .eq('workflow_id', targetId)
    const stepJobIds = (steps ?? [])
      .map((s) => s.agent_job_id as string | null)
      .filter((x): x is string => Boolean(x))
    if (stepJobIds.length === 0) return []
    const { data } = await supabase
      .from('agent_jobs')
      .select('id')
      .in('id', stepJobIds)
      .eq('queue_status', 'queued')
    return (data ?? []).map((r) => r.id as string)
  }

  if (targetKind === 'director_turn') {
    const ids = await jobIdsForTurn()
    for (const id of ids) await cancelOne(id)
    return
  }

  if (targetKind === 'workflow') {
    const ids = await jobIdsForWorkflow()
    for (const id of ids) await cancelOne(id)
    return
  }

  // brief — walk brief → stages → workflows → steps → agent_jobs.
  const { data: stages } = await supabase
    .from('brief_stages')
    .select('workflow_id')
    .eq('brief_id', targetId)
  const workflowIds = (stages ?? [])
    .map((s) => s.workflow_id as string | null)
    .filter((x): x is string => Boolean(x))
  if (workflowIds.length === 0) return
  const { data: steps } = await supabase
    .from('workflow_steps')
    .select('agent_job_id')
    .in('workflow_id', workflowIds)
  const stepJobIds = (steps ?? [])
    .map((s) => s.agent_job_id as string | null)
    .filter((x): x is string => Boolean(x))
  if (stepJobIds.length === 0) return
  const { data } = await supabase
    .from('agent_jobs')
    .select('id')
    .in('id', stepJobIds)
    .eq('queue_status', 'queued')
  const briefJobIds = (data ?? []).map((r) => r.id as string)
  for (const id of briefJobIds) await cancelOne(id)
}

/**
 * Check whether an active stop_request covers a director_turn. Used by
 * the per-iteration runner before each LLM call (cooperative abort).
 */
export async function isDirectorTurnStopRequested(directorTurnId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('stop_requests')
    .select('id')
    .eq('target_kind', 'director_turn')
    .eq('target_id', directorTurnId)
    .is('completed_at', null)
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}
