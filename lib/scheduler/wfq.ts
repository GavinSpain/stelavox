import 'server-only'

/**
 * V1.x-B.2.2 — Weighted Fair Queueing using the Virtual Finish Time
 * (VFT) algorithm.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.2 +
 *         Director Architecture v2.0 §9.4.
 *
 * For each non-empty traffic class, compute the VFT of the head-of-queue
 * ticket:
 *
 *   ticketCost   = estimated_input_tokens + estimated_output_tokens
 *   classWeight  = config.wfq_class_weights[traffic_class]
 *   classLastVft = wfq_state.class_N_last_vft
 *   ticketVft    = max(classLastVft, virtual_clock) + (ticketCost / classWeight)
 *
 * Pick the candidate ticket with the smallest ticketVft. Update wfq_state:
 *   class_N_last_vft = ticketVft
 *   virtual_clock    = ticketVft
 *
 * Aging promotion: a ticket queued > agent.aging_promotion_ms gets
 * effective traffic_class = max(1, traffic_class - 1) for the VFT calc.
 * Persistent traffic_class on agent_jobs unchanged. Prevents class-4
 * starvation under sustained heavy load.
 *
 * Tie-break: VFT ties (rare with NUMERIC(20,6)) fall back to queued_at FIFO.
 *
 * Ticket cost estimation: B.2.2 uses the conservative defaults
 * 2000 input + 500 output = 2500 total tokens per ticket. Future tuning
 * (V1.x-D) will read agent_profiles.estimated_input_tokens +
 * estimated_output_tokens (column additions deferred from B.2.4 §6.2.1).
 *
 * The pure math (computeVft + pickByMinVft + applyAgingPromotion) is
 * factored out for unit-testability without DB.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

// ---------------------------------------------------------------------------
// Pure math (unit-testable; no DB)
// ---------------------------------------------------------------------------

export interface WfqWeights {
  /** Weight per traffic class. Higher = more dispatch share. */
  [trafficClass: number]: number
}

export interface WfqClassState {
  /** Per-class last VFT (one of class_1_last_vft..class_4_last_vft on wfq_state). */
  classLastVft: number
  /** Effective virtual_clock at the moment of pick. */
  virtualClock: number
}

export interface WfqCandidate {
  ticketId: string
  trafficClass: 1 | 2 | 3 | 4
  /** estimated_input_tokens + estimated_output_tokens. */
  ticketCost: number
  /** When the ticket entered the queue (queued_at). */
  queuedAt: Date
}

export interface WfqPick {
  candidate: WfqCandidate
  computedVft: number
  /** The effective traffic class used for the VFT calc (may differ from candidate.trafficClass under aging promotion). */
  effectiveClass: 1 | 2 | 3 | 4
}

/**
 * Compute the VFT for one candidate at one class state.
 *
 *   ticketVft = max(classLastVft, virtualClock) + ticketCost / classWeight
 *
 * The max() ensures a class that's been quiet doesn't get a head start
 * far below virtual_clock.
 */
export function computeVft(
  candidate: WfqCandidate,
  state: WfqClassState,
  classWeight: number,
  effectiveClass: 1 | 2 | 3 | 4 = candidate.trafficClass,
): number {
  if (classWeight <= 0) {
    // Zero or negative weight = class disabled. Return Infinity to
    // ensure such a class never wins a pick.
    return Number.POSITIVE_INFINITY
  }
  void effectiveClass // documented; reserved for telemetry alongside the picked VFT
  const startVft = Math.max(state.classLastVft, state.virtualClock)
  return startVft + candidate.ticketCost / classWeight
}

/**
 * Apply aging promotion: a candidate queued longer than agingThresholdMs
 * gets effective traffic_class promoted by 1 (toward 1, the highest
 * priority). Persistent class unchanged.
 */
export function applyAgingPromotion(
  candidate: WfqCandidate,
  agingThresholdMs: number,
  now: Date = new Date(),
): 1 | 2 | 3 | 4 {
  const ageMs = now.getTime() - candidate.queuedAt.getTime()
  if (ageMs <= agingThresholdMs) return candidate.trafficClass
  // Promote one class toward 1.
  const promoted = Math.max(1, candidate.trafficClass - 1)
  return promoted as 1 | 2 | 3 | 4
}

/**
 * Pick the candidate with the smallest VFT given the current wfq_state
 * snapshot, the configured class weights, and the aging-promotion threshold.
 *
 * VFT ties: tie-break by queued_at FIFO (oldest first).
 *
 * Returns null if `candidates` is empty.
 */
export function pickByMinVft(
  candidates: WfqCandidate[],
  classLastVfts: { 1: number; 2: number; 3: number; 4: number },
  virtualClock: number,
  classWeights: WfqWeights,
  agingThresholdMs: number,
  now: Date = new Date(),
): WfqPick | null {
  if (candidates.length === 0) return null

  let best: WfqPick | null = null
  for (const c of candidates) {
    const effectiveClass = applyAgingPromotion(c, agingThresholdMs, now)
    const classWeight = classWeights[effectiveClass] ?? 0
    const classLastVft = classLastVfts[effectiveClass] ?? 0
    const vft = computeVft(c, { classLastVft, virtualClock }, classWeight, effectiveClass)

    if (best === null) {
      best = { candidate: c, computedVft: vft, effectiveClass }
      continue
    }
    if (vft < best.computedVft) {
      best = { candidate: c, computedVft: vft, effectiveClass }
      continue
    }
    if (vft === best.computedVft && c.queuedAt < best.candidate.queuedAt) {
      // Tie-break by FIFO.
      best = { candidate: c, computedVft: vft, effectiveClass }
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// DB-bound pick (consumed by lib/scheduler/dispatcher.ts)
// ---------------------------------------------------------------------------

interface WfqStateRow {
  virtual_clock: number
  class_1_last_vft: number
  class_2_last_vft: number
  class_3_last_vft: number
  class_4_last_vft: number
}

/**
 * Read the current WFQ state. The dispatcher does this inside its tick
 * transaction; for a separate read use `readWfqState()` directly.
 */
export async function readWfqState(): Promise<WfqStateRow> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('wfq_state')
    .select('virtual_clock, class_1_last_vft, class_2_last_vft, class_3_last_vft, class_4_last_vft')
    .eq('id', 1)
    .single()
  if (error || !data) {
    throw new Error(`readWfqState failed: ${error?.message ?? 'no row'}`)
  }
  return {
    virtual_clock: Number(data.virtual_clock),
    class_1_last_vft: Number(data.class_1_last_vft),
    class_2_last_vft: Number(data.class_2_last_vft),
    class_3_last_vft: Number(data.class_3_last_vft),
    class_4_last_vft: Number(data.class_4_last_vft),
  }
}

/**
 * Update wfq_state after a dispatch. Sets the picked class's last_vft to
 * the computed VFT AND advances virtual_clock to the same value.
 */
export async function updateWfqStateAfterDispatch(
  pickedClass: 1 | 2 | 3 | 4,
  pickedVft: number,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const colName = `class_${pickedClass}_last_vft` as const
  const { error } = await supabase
    .from('wfq_state')
    .update({
      [colName]: pickedVft,
      virtual_clock: pickedVft,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) {
    throw new Error(`updateWfqStateAfterDispatch failed: ${error.message}`)
  }
}

/**
 * Read the configured WFQ class weights from platform_config.
 * Defaults to {1:50, 2:25, 3:20, 4:5} if the key is absent (defensive
 * — M-114 seeds the canonical values).
 */
export async function readWfqClassWeights(): Promise<WfqWeights> {
  const raw = (await getConfig<Record<string, number>>('agent.wfq_class_weights')) ?? null
  if (!raw) return { 1: 50, 2: 25, 3: 20, 4: 5 }
  // platform_config keys are JSON; coerce string keys to numbers.
  const out: WfqWeights = {}
  for (const [k, v] of Object.entries(raw)) {
    out[Number(k)] = Number(v)
  }
  return out
}

export async function readAgingThresholdMs(): Promise<number> {
  const v = await getConfig<number>('agent.aging_promotion_ms')
  return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 60_000
}

/**
 * Default per-ticket cost estimate when the agent_profile-level
 * estimated_input_tokens / estimated_output_tokens columns aren't
 * populated. B.2.2 ships this fallback; B.2.4 will populate per-profile
 * estimates.
 *
 * Director iterations are typically larger (15-30k tokens) but they're
 * always class 1 — the WFQ math handles it correctly via classWeight=50.
 */
export const DEFAULT_TICKET_COST = 2500
