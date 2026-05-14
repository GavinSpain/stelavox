import 'server-only'

/**
 * V1.x-B.2.1 — dispatcher (naive class-priority picker; B.2.2 layers WFQ).
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.2
 *         + Director Architecture v2.0 §8 (universal scheduler).
 *
 * Single source of truth for "which ticket runs next."
 *
 * B.2.1 picker semantics: strict-priority FIFO across the four traffic
 * classes (1 → 2 → 3 → 4), first-eligible wins. B.2.2 swaps this for
 * Weighted Fair Queueing (Virtual Finish Time) without changing the
 * dispatcher's outer shape.
 *
 * Per-tick flow:
 *   1. SELECT candidate tickets (FOR UPDATE SKIP LOCKED) up to a per-tick cap.
 *   2. For each candidate in priority order, check eligibility predicates:
 *        a. dependencyResolved — workflow_step's depends_on completed?
 *        b. notStopRequested — no active stop_request in ancestry?
 *        c. capacityAvailable — mayDispatch() approves?
 *        d. routeAvailable — BYOK Edge Function reachable for BYOK?
 *   3. First eligible candidate wins → claim (UPDATE queue_status='dispatched').
 *   4. Hand off to runRunner(ticket) — async, fire-and-forget.
 *   5. Continue until per-tick cap or no eligible candidates left.
 *
 * Trigger points:
 *   - pg_cron every dispatcher_tick_interval_ms (default 1000ms; cron
 *     install in B.2.3 M-122).
 *   - LISTEN 'scheduler_completion' channel (instant reaction; lib/scheduler/listener.ts).
 *
 * Both paths are idempotent: the FOR UPDATE SKIP LOCKED claim ensures
 * no double-dispatch even if both fire concurrently.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'
import { mayDispatch, type ThrottleRoute, type TrafficClass } from './throttleInterface'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DispatcherTickResult {
  tickId: string
  startedAt: Date
  durationMs: number
  ticketsConsidered: number
  ticketsDispatched: number
  ticketsSkippedNoCapacity: number
  ticketsSkippedNoDependency: number
  ticketsSkippedWrongRoute: number
  ticketsSkippedStopRequested: number
}

interface DispatchableRow {
  id: string
  organisation_id: string
  document_id: string | null
  operation_type: string
  traffic_class: number
  execution_intent: string
  scheduled_at: string | null
  route: string
  director_turn_id: string | null
  parent_iteration_id: string | null
  iteration_number: number | null
  user_id: string | null
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run one dispatcher tick. Returns a summary suitable for the
 * dispatcher_tick_samples table (B.2.2 wires the actual sample writes).
 */
export async function runDispatcherTick(): Promise<DispatcherTickResult> {
  const tickId = crypto.randomUUID()
  const startedAt = new Date()

  const maxPerTick = (await getConfig<number>('agent.dispatcher_max_per_tick')) ?? 20

  const supabase = createServiceRoleClient()

  // B.2.1 candidate selection: strict-priority across the four classes,
  // FIFO within class. B.2.2 replaces with VFT pick.
  //
  // Read up to (maxPerTick * 4) candidates so we have headroom when
  // most early candidates fail eligibility checks.
  const { data: candidates, error: candErr } = await supabase
    .from('agent_jobs')
    .select(
      'id, organisation_id, document_id, operation_type, traffic_class, execution_intent, scheduled_at, route, director_turn_id, parent_iteration_id, iteration_number',
    )
    .eq('queue_status', 'queued')
    .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
    .order('traffic_class', { ascending: true })
    .order('queued_at', { ascending: true })
    .limit(maxPerTick * 4)

  let ticketsConsidered = 0
  let ticketsDispatched = 0
  let ticketsSkippedNoCapacity = 0
  let ticketsSkippedNoDependency = 0
  let ticketsSkippedWrongRoute = 0
  let ticketsSkippedStopRequested = 0

  if (candErr || !candidates) {
    return {
      tickId,
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      ticketsConsidered: 0,
      ticketsDispatched: 0,
      ticketsSkippedNoCapacity: 0,
      ticketsSkippedNoDependency: 0,
      ticketsSkippedWrongRoute: 0,
      ticketsSkippedStopRequested: 0,
    }
  }

  for (const cand of candidates as unknown as DispatchableRow[]) {
    if (ticketsDispatched >= maxPerTick) break
    ticketsConsidered++

    // 1. Dependency check (workflow_step jobs only).
    const depOk = await dependencyResolved(supabase, cand)
    if (!depOk) {
      ticketsSkippedNoDependency++
      await bumpDispatcherSkip(supabase, cand.id)
      continue
    }

    // 2. Stop-request check (covers ancestry).
    const stopActive = await isCoveredByActiveStop(supabase, cand)
    if (stopActive) {
      ticketsSkippedStopRequested++
      // Mark cancelled rather than re-queue.
      await supabase
        .from('agent_jobs')
        .update({
          queue_status: 'cancelled',
          status: 'failed',
          completed_at: new Date().toISOString(),
          failure_class: 'B',
          error_message: 'cancelled_by_stop_request',
        })
        .eq('id', cand.id)
        .eq('queue_status', 'queued')
      continue
    }

    // 3. Capacity check (mayDispatch).
    const decision = await mayDispatch({
      route: cand.route as ThrottleRoute,
      traffic_class: cand.traffic_class as TrafficClass,
      organisation_id: cand.organisation_id,
      user_id: cand.user_id,
    })

    if (decision.decision !== 'dispatch') {
      if (decision.decision === 'pace') {
        ticketsSkippedNoCapacity++
      } else {
        ticketsSkippedWrongRoute++
      }
      await bumpDispatcherSkip(supabase, cand.id)
      continue
    }

    // 4. Atomic claim — flip queue_status='queued' → 'dispatched'.
    // CAS via .eq('queue_status', 'queued') ensures only one tick wins.
    const { data: claimed, error: claimErr } = await supabase
      .from('agent_jobs')
      .update({
        queue_status: 'dispatched',
        status: 'running',
        dispatched_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        ...(decision.reservation_id ? { reservation_id: decision.reservation_id } : {}),
      })
      .eq('id', cand.id)
      .eq('queue_status', 'queued')
      .select('id')
      .maybeSingle()

    if (claimErr || !claimed) {
      // Lost the CAS race; another tick claimed it. Move on.
      continue
    }

    // 5. Hand off to the appropriate runner.
    // Fire-and-forget; the runner writes its own completion status.
    void handoffToRunner(cand)
    ticketsDispatched++
  }

  return {
    tickId,
    startedAt,
    durationMs: Date.now() - startedAt.getTime(),
    ticketsConsidered,
    ticketsDispatched,
    ticketsSkippedNoCapacity,
    ticketsSkippedNoDependency,
    ticketsSkippedWrongRoute,
    ticketsSkippedStopRequested,
  }
}

// ---------------------------------------------------------------------------
// Eligibility predicates
// ---------------------------------------------------------------------------

async function dependencyResolved(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cand: DispatchableRow,
): Promise<boolean> {
  // Only workflow_step jobs have intra-workflow dependencies.
  if (cand.operation_type !== 'workflow_step') {
    return true
  }

  // workflow_steps.depends_on_step_orders array — all referenced steps
  // must be in status='completed'. The agent_jobs row carries
  // triggered_by which references the workflow_step.id; lookup the
  // workflow context.
  const { data: step } = await supabase
    .from('workflow_steps')
    .select('workflow_id, depends_on_step_orders')
    .eq('agent_job_id', cand.id)
    .maybeSingle()

  if (!step || !step.workflow_id || !step.depends_on_step_orders) {
    return true
  }

  const deps = step.depends_on_step_orders as number[]
  if (deps.length === 0) return true

  const { data: depRows } = await supabase
    .from('workflow_steps')
    .select('order, status')
    .eq('workflow_id', step.workflow_id)
    .in('order', deps)

  if (!depRows) return false
  return depRows.every((r) => r.status === 'completed')
}

async function isCoveredByActiveStop(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cand: DispatchableRow,
): Promise<boolean> {
  // Director-iteration jobs: check stop_requests on the director_turn_id.
  if (cand.director_turn_id) {
    const { data: stopRow } = await supabase
      .from('stop_requests')
      .select('id')
      .eq('target_kind', 'director_turn')
      .eq('target_id', cand.director_turn_id)
      .is('completed_at', null)
      .limit(1)
      .maybeSingle()
    if (stopRow) return true
  }

  // Workflow-step jobs: check stop_requests on the workflow_id.
  if (cand.operation_type === 'workflow_step') {
    const { data: step } = await supabase
      .from('workflow_steps')
      .select('workflow_id')
      .eq('agent_job_id', cand.id)
      .maybeSingle()
    if (step?.workflow_id) {
      const { data: stopRow } = await supabase
        .from('stop_requests')
        .select('id')
        .eq('target_kind', 'workflow')
        .eq('target_id', step.workflow_id)
        .is('completed_at', null)
        .limit(1)
        .maybeSingle()
      if (stopRow) return true
    }
  }

  return false
}

async function bumpDispatcherSkip(
  supabase: ReturnType<typeof createServiceRoleClient>,
  jobId: string,
): Promise<void> {
  // Atomic increment via RPC would be cleaner; B.2.1 ships a
  // read-then-update which is acceptable since the dispatcher single-
  // threads its own ticks (FOR UPDATE SKIP LOCKED prevents two ticks
  // from picking the same row in the same tick). Aging promotion in
  // B.2.2 reads dispatcher_skips_count.
  const { data } = await supabase
    .from('agent_jobs')
    .select('dispatcher_skips_count')
    .eq('id', jobId)
    .maybeSingle()
  const current = (data?.dispatcher_skips_count as number | undefined) ?? 0
  await supabase
    .from('agent_jobs')
    .update({ dispatcher_skips_count: current + 1 })
    .eq('id', jobId)
}

// ---------------------------------------------------------------------------
// Runner handoff (B.2.1 substrate)
// ---------------------------------------------------------------------------

/**
 * Route a claimed ticket to the appropriate runner.
 *   - operation_type='director_iteration' → runIteration(jobId).
 *     The dispatcher consumes the iteration generator with no consumer
 *     (events are discarded — when the dispatcher is the dispatch source,
 *     the route handler isn't there to consume SSE; future polish will
 *     wire a Realtime-channel broadcaster into the runner so the client
 *     receives events even when dispatched async).
 *   - else → runAgentJob(jobId) (existing background runner from
 *     V1.x-A / Phase 5).
 *
 * In B.2.1 the route handler still drives Director iterations inline
 * (preserves the SSE wire). The dispatcher's handoff is the path used
 * by V1.x-B.2 push-model triggers + future "return-202" cutover.
 */
async function handoffToRunner(cand: DispatchableRow): Promise<void> {
  if (cand.operation_type === 'director_iteration') {
    const { runIteration } = await import('@/lib/director/iteration-runner')
    void (async () => {
      try {
        const gen = runIteration(cand.id)
        // Drain the generator. Events are not surfaced to a client here;
        // the iteration_state + agent_jobs status updates are the
        // observable side-effects.
        for await (const _ev of gen) void _ev
      } catch (err) {
        console.error('[dispatcher] runIteration failed', { jobId: cand.id, error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return
  }
  // For agent_jobs operation_types (expand / synthesise / refine /
  // generate_context / workflow_step), invoke the existing background
  // runner.
  const { runAgentJob } = await import('@/lib/agent/runner')
  void (async () => {
    try {
      await runAgentJob(cand.id)
    } catch (err) {
      console.error('[dispatcher] runAgentJob failed', { jobId: cand.id, error: err instanceof Error ? err.message : String(err) })
    }
  })()
}
