import 'server-only'

/**
 * V1.x-B.1.1 session 3a — atom-size violation logger.
 *
 * Source: V1.x-B.1.1 build checklist §3.3 T-3.3 + design record §8 +
 *         M-094 constraint_violations table.
 *
 * Companion to preflight.ts: when preflightCheck returns ok:false, the
 * caller surfaces a Class D failure to the user AND calls recordViolation
 * here to log to the telemetry table. The dataset informs cap tuning.
 *
 * Session 3a ships the INSERT path. Session 3b wires the call sites
 * (executor's tool-result serialiser + iteration N+1 enqueue gate).
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import type { ViolationContext, ViolationType } from './types'

export interface RecordViolationInput {
  type: ViolationType
  attempted_value: number
  configured_cap: number
  context?: ViolationContext
}

/**
 * INSERT a constraint_violations row. Best-effort fire-and-forget —
 * if the INSERT fails (e.g. DB unavailable), we log to console and
 * continue. The user-facing failure path doesn't depend on this row
 * existing; the row is for capability-tuning telemetry only.
 *
 * Returns the inserted row id, or null on best-effort failure.
 */
export async function recordViolation(input: RecordViolationInput): Promise<string | null> {
  const supabase = createServiceRoleClient()
  const ctx = input.context ?? {}
  const { data, error } = await supabase
    .from('constraint_violations')
    .insert({
      violation_type: input.type,
      attempted_value: Math.max(0, Math.trunc(input.attempted_value)),
      configured_cap: Math.max(0, Math.trunc(input.configured_cap)),
      context: {
        organisation_id: ctx.organisation_id,
        user_id: ctx.user_id,
        document_id: ctx.document_id,
        brief_id: ctx.brief_id,
        tool_name: ctx.tool_name,
        operation_type: ctx.operation_type,
        notes: ctx.notes,
      },
      user_id: ctx.user_id ?? null,
      organisation_id: ctx.organisation_id ?? null,
    })
    .select('id')
    .single()

  if (error || !data) {
    // Telemetry write failed — log and swallow. The user-facing error
    // path doesn't depend on this row existing.
    console.warn('[constraints/recordViolation] insert failed:', error?.message ?? 'no row returned', {
      type: input.type,
      attempted: input.attempted_value,
      cap: input.configured_cap,
    })
    return null
  }

  return data.id
}
