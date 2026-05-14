import 'server-only'

/**
 * V1.x-B.1.1 session 3a — TS wrappers for the stage trigger evaluator.
 *
 * The SQL procedure `evaluate_ready_stage_triggers()` (Migration 102)
 * is the canonical evaluator. pg_cron invokes it every 30s. This module
 * exposes a TS wrapper for:
 *   - manual invocation (tests, admin paths, in-band trigger after
 *     Brief lifecycle propagation completes a stage)
 *   - direct invocation (in-process, lower-latency than waiting for the
 *     30-second pg_cron cycle)
 *
 * Session 3b adds enqueueDirectorPlanningTurn() that converts a fired
 * trigger into an immediate Director iteration job (push-model). For
 * B.1.1 substrate / 3a, the trigger fires the system event into the
 * conversation; the Director picks it up on the next user prompt
 * (pull-model).
 */

import { createServiceRoleClient } from '@/lib/supabase/service'

export interface EvaluateStageTriggersResult {
  triggers_fired: number
}

/**
 * Invoke the SQL evaluator. Returns the count of triggers fired this
 * call. Idempotent — safely callable in-band after every Brief
 * lifecycle propagation; the SQL `WHERE bs.status = 'planned'` guard
 * prevents double-firing.
 */
export async function evaluateReadyStageTriggers(): Promise<EvaluateStageTriggersResult> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase.rpc('evaluate_ready_stage_triggers')
  if (error) throw new Error(`evaluate_ready_stage_triggers failed: ${error.message}`)
  return { triggers_fired: typeof data === 'number' ? data : Number(data ?? 0) }
}
