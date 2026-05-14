import 'server-only'

/**
 * V1.x-B.1.1 — Atom-size pre-flight checks.
 *
 * Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.3 T-3.3
 *         + design record §8.
 *
 * SESSION-1 SCOPE — pre-flight evaluator + cap reader only. The
 * recordViolation INSERT path lands in session 2 alongside the
 * per-iteration runner integration (the natural call sites are tool-
 * result serialisation and iteration N+1 enqueue).
 *
 * Two checkable caps in B.1.1:
 *   - constraints.max_tool_result_bytes — per-tool result payload size.
 *   - constraints.max_iterations_per_turn — max iterations before the
 *     per-turn cap forces termination.
 *
 * The third (constraints.max_profile_size_bytes) is a soft watch
 * surfaced via 'profile_size_warned' violations in session 2; it does
 * not reject in B.1.1 — Profile-summarisation candidate is V2.
 */

import { getConfig } from '@/lib/config/platform-config'
import type { PreflightResult, ViolationType } from './types'

/** Reads the configured cap for a given violation type from platform_config. */
export async function getCap(type: ViolationType): Promise<number> {
  switch (type) {
    case 'tool_result_size_exceeded':
      return (await getConfig<number>('constraints.max_tool_result_bytes')) ?? 524288
    case 'iterations_per_turn_exceeded':
      return (await getConfig<number>('constraints.max_iterations_per_turn')) ?? 20
    case 'profile_size_warned':
      return (await getConfig<number>('constraints.max_profile_size_bytes')) ?? 65536
  }
}

/**
 * Pre-flight evaluator. Returns ok:true when within cap; ok:false +
 * structured violation otherwise. Caller surfaces a Class D failure
 * on .ok=false.
 */
export async function preflightCheck(
  type: ViolationType,
  attemptedValue: number,
): Promise<PreflightResult> {
  const cap = await getCap(type)
  if (attemptedValue <= cap) {
    return { ok: true }
  }
  return {
    ok: false,
    violation: {
      type,
      attempted_value: attemptedValue,
      configured_cap: cap,
      message: messageFor(type, attemptedValue, cap),
    },
  }
}

function messageFor(type: ViolationType, attempted: number, cap: number): string {
  switch (type) {
    case 'tool_result_size_exceeded':
      return `Tool result size ${attempted} bytes exceeds the configured cap of ${cap} bytes. Narrow the request (smaller depth, fewer nodes) or use a more targeted read tool.`
    case 'iterations_per_turn_exceeded':
      return `Director turn reached ${attempted} iterations, exceeding the per-turn cap of ${cap}. The runtime closed the loop.`
    case 'profile_size_warned':
      return `Project Profile reached ${attempted} bytes (soft watch threshold ${cap}). Profile-summarisation candidate is V2.`
  }
}
