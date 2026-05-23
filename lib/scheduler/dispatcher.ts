import 'server-only'

/**
 * V1.x-B.2 — dispatcher (B.2.2: WFQ-VFT picker + per-pool buckets +
 * Class 1 reserved slots + per-tick metrics).
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.2 + §4 +
 *         Director Architecture v2.0 §8 (universal scheduler) + §9
 *         (throttling and traffic engineering).
 *
 * Single source of truth for "which ticket runs next."
 *
 * Per-tick flow (B.2.2):
 *   1. SELECT candidate tickets (queue_status='queued', not future-scheduled).
 *   2. For each, run cheap-first eligibility predicates:
 *        a. dependencyResolved (workflow_step depends_on)
 *        b. notStopRequested (cascade Stop)
 *   3. WFQ pick: pickByMinVft over the surviving candidates → one winner.
 *   4. Reserve capacity for the winner:
 *        a. checkAndReserve on the bucket (per-pool token reservation)
 *        b. claimClass1Slot if winner is Class 1 (concurrent-connection slot)
 *      If either fails: leave winner queued, advance dispatcher_skips_count++,
 *      try the NEXT candidate by VFT order.
 *   5. Atomic CAS claim (queue_status='queued' → 'dispatched').
 *      Stamp wfq_vft_at_dispatch + reservation_id + route metadata.
 *      Update wfq_state (advance class_N_last_vft + virtual_clock).
 *   6. Hand off to runner (fire-and-forget).
 *   7. Continue picking until no more eligible candidates OR per-tick cap.
 *   8. Write dispatcher_tick_samples row.
 *
 * Trigger points (unchanged from B.2.1):
 *   - pg_cron every dispatcher_tick_interval_ms (B.2.3 wires this)
 *   - LISTEN 'scheduler_completion' channel (lib/scheduler/listener.ts)
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'
import {
  pickByMinVft,
  readWfqState,
  readWfqClassWeights,
  readAgingThresholdMs,
  updateWfqStateAfterDispatch,
  DEFAULT_TICKET_COST,
  type WfqCandidate,
} from './wfq'
import { checkAndReserve, poolKeyFor } from './buckets'
import { claimClass1Slot, releaseClass1Slot, readSlotsInUse } from './reserved-slots'
import { recordDispatcherTickSample, readDispatcherSampleSnapshot } from './metrics-samplers'

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
  queued_at: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runDispatcherTick(): Promise<DispatcherTickResult> {
  const tickId = crypto.randomUUID()
  const startedAt = new Date()

  const maxPerTick = (await getConfig<number>('agent.dispatcher_max_per_tick')) ?? 20
  const supabase = createServiceRoleClient()

  // 1. Read candidates. We pull a generous window so the WFQ picker has
  // headroom across all 4 classes; the per-tick cap caps actual claims.
  const candidatePoolSize = Math.max(maxPerTick * 4, 20)
  const { data: rawCandidates, error: candErr } = await supabase
    .from('agent_jobs')
    .select(
      'id, organisation_id, document_id, operation_type, traffic_class, execution_intent, scheduled_at, route, director_turn_id, parent_iteration_id, iteration_number, queued_at',
    )
    .eq('queue_status', 'queued')
    // M-205 (Apollo iteration-fork fix): the dispatcher is the sole
    // consumer for consumer_kind='dispatcher' rows. Rows tagged
    // 'inline_route' are owned by /api/director/message's inline
    // runIteration loop and must not be considered for dispatch.
    // The SQL-side gate is in agent_jobs_notify_insert (no NOTIFY
    // fires for inline rows); this query filter is defence-in-depth
    // for the recovery sweep path that runs ticks via the reconcile
    // schedule rather than the INSERT NOTIFY.
    .eq('consumer_kind', 'dispatcher')
    // 2026-05-22 — defence-in-depth: refuse to consider any row that
    // already has completed_at set. The terminal-state write in
    // persistFinalResult / persistFailure / persistCancellation /
    // accept_agent_job sets queue_status to a terminal value as of
    // 2026-05-22, so this should never match in steady state. But if
    // a pre-fix zombie row exists (status='completed', queue_status=
    // 'queued', completed_at set), this guard prevents the dispatcher
    // from resurrecting it. See lib/agent/job-lifecycle.ts header for
    // the full root-cause explanation.
    .is('completed_at', null)
    .or('scheduled_at.is.null,scheduled_at.lte.' + new Date().toISOString())
    .order('queued_at', { ascending: true })
    .limit(candidatePoolSize)

  let ticketsConsidered = 0
  let ticketsDispatched = 0
  let ticketsSkippedNoCapacity = 0
  let ticketsSkippedNoDependency = 0
  // ticketsSkippedWrongRoute is never reassigned in B.2.2 — the
  // mayDispatch shape from B.1.1 (decision.decision === 'reject' for
  // bad route) is unused here because B.2.2 routes through
  // checkAndReserve which doesn't have a wrong-route concept (BYOK
  // pools auto-create on first use). Reserved for future use when
  // route-validation lands as a distinct gate.
  const ticketsSkippedWrongRoute = 0
  let ticketsSkippedStopRequested = 0

  if (candErr || !rawCandidates) {
    const result: DispatcherTickResult = {
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
    await writeTickSample(result, 0, 0)
    return result
  }

  const candidates = rawCandidates as unknown as DispatchableRow[]

  // 2. Filter eligibility (dependency + stop-request). The WFQ picker
  //    only sees the survivors. Tickets removed from `eligible` here
  //    aren't counted as "skipped no capacity" — they have real reasons
  //    (deps not met / stop-requested) tracked separately.
  const eligible: DispatchableRow[] = []
  for (const cand of candidates) {
    ticketsConsidered++
    const depOk = await dependencyResolved(supabase, cand)
    if (!depOk) {
      ticketsSkippedNoDependency++
      await bumpDispatcherSkip(supabase, cand.id)
      continue
    }
    const stopActive = await isCoveredByActiveStop(supabase, cand)
    if (stopActive) {
      ticketsSkippedStopRequested++
      // Apollo Phase 3: delegate to orchestration. queued → cancelled is
      // a legal transition; the trigger refuses anything else.
      const { transitionAgentJob } = await import('@/lib/orchestration')
      await transitionAgentJob(supabase, cand.id, 'cancel_or_cascade', 'cancelled', {
        errorMessage: 'cancelled_by_stop_request',
        failureClass: 'B',
      })
      continue
    }
    eligible.push(cand)
  }

  // 3..7. WFQ pick + capacity + claim loop. Each iteration picks the
  //    smallest-VFT survivor; on capacity failure the loser is removed
  //    from `remaining` and we re-pick from what's left.
  const remaining = [...eligible]
  const wfqWeights = await readWfqClassWeights()
  const agingThresholdMs = await readAgingThresholdMs()

  while (ticketsDispatched < maxPerTick && remaining.length > 0) {
    // Re-read wfq_state on every pick (the previous dispatch within
    // this tick mutated it). Note: under heavy concurrent dispatchers,
    // FOR UPDATE on wfq_state would serialise picks; for B.2.2 we
    // accept best-effort reads + atomic update-after-dispatch.
    const state = await readWfqState()

    const wfqCandidates: WfqCandidate[] = remaining.map((r) => ({
      ticketId: r.id,
      trafficClass: r.traffic_class as 1 | 2 | 3 | 4,
      ticketCost: DEFAULT_TICKET_COST, // V1.x-D will read agent_profiles.estimated_*
      queuedAt: new Date(r.queued_at),
    }))

    const pick = pickByMinVft(
      wfqCandidates,
      {
        1: state.class_1_last_vft,
        2: state.class_2_last_vft,
        3: state.class_3_last_vft,
        4: state.class_4_last_vft,
      },
      state.virtual_clock,
      wfqWeights,
      agingThresholdMs,
    )
    if (!pick) break

    const pickedRow = remaining.find((r) => r.id === pick.candidate.ticketId)!
    // Drop from remaining regardless of whether claim succeeds; we'll
    // re-add only on a CAS race retry.
    const remainingIdx = remaining.findIndex((r) => r.id === pickedRow.id)
    remaining.splice(remainingIdx, 1)

    // 4. Capacity reservation.
    const route = (pickedRow.route as 'platform' | 'byok') ?? 'platform'
    const poolKey = poolKeyFor(route, pickedRow.user_id)
    const reservation = await checkAndReserve(poolKey, DEFAULT_TICKET_COST, pickedRow.id)
    if (!reservation.reserved) {
      ticketsSkippedNoCapacity++
      await bumpDispatcherSkip(supabase, pickedRow.id)
      continue
    }

    // 4b. Class 1 reserved-slot claim.
    let class1ClaimOutcome: 'reserved' | 'overflow' | 'denied' | null = null
    if (pickedRow.traffic_class === 1) {
      class1ClaimOutcome = await claimClass1Slot()
      if (class1ClaimOutcome === 'denied') {
        ticketsSkippedNoCapacity++
        await bumpDispatcherSkip(supabase, pickedRow.id)
        // Refund the bucket reservation eagerly.
        const { reconcile } = await import('./buckets')
        await reconcile(poolKey, pickedRow.id, DEFAULT_TICKET_COST)
        continue
      }
    }

    // 5. Atomic claim — flip queue_status='queued' → 'dispatched' with CAS.
    // 2026-05-22 — dispatcher owns QUEUE lifecycle (queue_status); the
    // runner owns BUSINESS lifecycle (status). Pre-fix the dispatcher
    // also wrote status='running' + started_at=now as part of the
    // claim, which violated the M-106 two-column separation. The
    // runner's loadJobAndProfile + persistRunningStart both filter on
    // status='pending'; with status='running' set by the dispatcher,
    // loadJobAndProfile returned { kind: 'job_not_pending' } and the
    // runner SKIPPED the job entirely. User surfaced 2026-05-22 on the
    // "Into the Ice" stage 2 expand step: dispatched at 09:13:26,
    // status='running' / queue_status='dispatched', last_heartbeat_at
    // never written, dev log showed `[agent-runner] job not in pending
    // state, skipping`.
    //
    // Director iteration handoff (lib/director/iteration-runner) was
    // unaffected because it manages its own status transitions on
    // entry — line 432 unconditionally sets status='running'. Only the
    // runAgentJob path was broken.
    // Apollo Phase 3: delegate to orchestration. queued → dispatched is
    // the legal CAS transition. The DB trigger ensures no concurrent
    // dispatcher can re-claim a row that's already terminal (the audit
    // function's completed_at IS NULL invariant is also enforced by the
    // earlier .is('completed_at', null) candidate filter).
    const { transitionAgentJob } = await import('@/lib/orchestration')
    const claimResult = await transitionAgentJob(supabase, pickedRow.id, 'dispatcher_cas_claim', 'dispatched', {
      dispatcherFields: {
        dispatched_at: new Date().toISOString(),
        reservation_id: reservation.reservationId,
        wfq_vft_at_dispatch: pick.computedVft,
      },
    })
    const claimed = claimResult.ok ? { id: pickedRow.id } : null
    const claimErr = claimResult.ok ? null : { message: claimResult.message ?? claimResult.error ?? 'unknown' }

    if (claimErr || !claimed) {
      // CAS lost. Refund the bucket + Class 1 slot we just claimed.
      const { reconcile } = await import('./buckets')
      await reconcile(poolKey, pickedRow.id, DEFAULT_TICKET_COST)
      if (class1ClaimOutcome) await releaseClass1Slot()
      continue
    }

    // 5b. Advance wfq_state.
    try {
      await updateWfqStateAfterDispatch(pick.effectiveClass, pick.computedVft)
    } catch (err) {
      // Non-fatal: a failed wfq_state update means subsequent picks in
      // this tick may pick suboptimally, but the dispatch already
      // succeeded.
      console.error('[dispatcher] updateWfqStateAfterDispatch failed', err instanceof Error ? err.message : String(err))
    }

    // 6. Hand off to the appropriate runner. Fire-and-forget.
    void handoffToRunner(pickedRow)
    ticketsDispatched++
  }

  // 8. Write the per-tick metric sample.
  const result: DispatcherTickResult = {
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
  await writeTickSample(result, await readSlotsInUse(), 0)
  return result
}

async function writeTickSample(
  result: DispatcherTickResult,
  class1SlotsInUse: number,
  _placeholder: number,
): Promise<void> {
  void _placeholder
  try {
    const snapshot = await readDispatcherSampleSnapshot()
    const state = await readWfqState()
    await recordDispatcherTickSample({
      tickStartedAt: result.startedAt,
      durationMs: result.durationMs,
      ticketsConsidered: result.ticketsConsidered,
      ticketsDispatched: result.ticketsDispatched,
      ticketsSkippedNoCapacity: result.ticketsSkippedNoCapacity,
      ticketsSkippedNoDependency: result.ticketsSkippedNoDependency,
      ticketsSkippedWrongRoute: result.ticketsSkippedWrongRoute,
      ticketsSkippedStopRequested: result.ticketsSkippedStopRequested,
      queueDepthClass1: snapshot.queueDepthClass1,
      queueDepthClass2: snapshot.queueDepthClass2,
      queueDepthClass3: snapshot.queueDepthClass3,
      queueDepthClass4: snapshot.queueDepthClass4,
      virtualClock: state.virtual_clock,
      class1ReservedSlotsInUse: class1SlotsInUse,
      activeThrottleReservationsCount: snapshot.activeThrottleReservationsCount,
    })
  } catch (err) {
    console.error('[dispatcher] tick sample write failed', err instanceof Error ? err.message : String(err))
  }
}

// ---------------------------------------------------------------------------
// Eligibility predicates (carried over from B.2.1 substrate, unchanged)
// ---------------------------------------------------------------------------

async function dependencyResolved(
  supabase: ReturnType<typeof createServiceRoleClient>,
  cand: DispatchableRow,
): Promise<boolean> {
  if (cand.operation_type !== 'workflow_step') return true

  const { data: step } = await supabase
    .from('workflow_steps')
    .select('workflow_id, depends_on_step_orders')
    .eq('agent_job_id', cand.id)
    .maybeSingle()
  if (!step || !step.workflow_id || !step.depends_on_step_orders) return true

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
// Runner handoff (carried over from B.2.1 — wires director_iteration → runIteration; else → runAgentJob)
// ---------------------------------------------------------------------------

async function handoffToRunner(cand: DispatchableRow): Promise<void> {
  if (cand.operation_type === 'director_iteration') {
    const { runIteration } = await import('@/lib/director/iteration-runner')
    void (async () => {
      try {
        const gen = runIteration(cand.id)
        for await (const _ev of gen) void _ev
      } catch (err) {
        console.error('[dispatcher] runIteration failed', { jobId: cand.id, error: err instanceof Error ? err.message : String(err) })
      }
    })()
    return
  }
  const { runAgentJob } = await import('@/lib/agent/runner')
  void (async () => {
    try {
      await runAgentJob(cand.id)
    } catch (err) {
      console.error('[dispatcher] runAgentJob failed', { jobId: cand.id, error: err instanceof Error ? err.message : String(err) })
    }
  })()
}
