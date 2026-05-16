import 'server-only'

/**
 * V1.x-E.2 — synthetic probe runner.
 *
 * Source: Component Spec §17.5 §7 · wireframe_admin_dashboard_v1.html §05
 * M-144 (synthetic_probe_runs schema) + decision 2 (probes ship in E).
 *
 * Flow:
 *   1. INSERT a synthetic_probe_runs row at status (outcome=NULL).
 *   2. Dispatch the probe-specific implementation; await result.
 *   3. UPDATE the row with outcome + duration + tokens + cost (or
 *      failure_class + error_message).
 *
 * V1 probe implementations:
 *   - director_small  — real: pings Anthropic Messages API with a
 *                       minimal completion. Verifies platform key +
 *                       network + provider liveness.
 *   - workflow_expand — substrate stub: records a 'fail' row with
 *                       failure_class='E' + error_message
 *                       'probe_implementation_pending_v1xf'. Wired in
 *                       V1.x-F polish once probe-fixture data lands.
 *   - refine_accept   — same as above.
 *
 * Probes are operator-only (admin auth at the route layer) and write
 * via the service-role client (admin scope, RLS denies user reads on
 * synthetic_probe_runs).
 */

import Anthropic from '@anthropic-ai/sdk'

import type { SupabaseClient } from '@supabase/supabase-js'

export type ProbeId = 'director_small' | 'workflow_expand' | 'refine_accept'
export type ProbeTriggeredBy = 'manual' | 'cron'

export interface ProbeRunResult {
  outcome: 'pass' | 'fail'
  duration_ms: number
  tokens_input: number | null
  tokens_output: number | null
  cost_credits: number | null
  agent_job_id: string | null
  director_turn_id: string | null
  failure_class: string | null
  error_message: string | null
  metadata: Record<string, unknown> | null
}

const VALID_PROBE_IDS: ProbeId[] = ['director_small', 'workflow_expand', 'refine_accept']

export function isValidProbeId(s: string): s is ProbeId {
  return (VALID_PROBE_IDS as string[]).includes(s)
}

interface RunContext {
  svc: SupabaseClient
  probeId: ProbeId
  triggeredBy: ProbeTriggeredBy
}

/**
 * Public entry point — INSERTs the open row, dispatches, then UPDATEs
 * with the result. Always returns the synthetic_probe_runs row id so
 * the caller can echo it to the admin UI.
 */
export async function runProbe(ctx: RunContext): Promise<{ id: number; result: ProbeRunResult }> {
  const insertResp = await ctx.svc
    .from('synthetic_probe_runs')
    .insert({
      probe_id: ctx.probeId,
      triggered_by: ctx.triggeredBy,
    })
    .select('id')
    .single()

  if (insertResp.error || !insertResp.data) {
    throw new Error(`Failed to record probe start: ${insertResp.error?.message ?? 'no row returned'}`)
  }
  const rowId = insertResp.data.id as number

  let result: ProbeRunResult
  try {
    result = await dispatchProbe(ctx.probeId)
  } catch (err) {
    result = {
      outcome: 'fail',
      duration_ms: 0,
      tokens_input: null,
      tokens_output: null,
      cost_credits: null,
      agent_job_id: null,
      director_turn_id: null,
      failure_class: 'E',
      error_message: err instanceof Error ? err.message : String(err),
      metadata: null,
    }
  }

  await ctx.svc
    .from('synthetic_probe_runs')
    .update({
      completed_at: new Date().toISOString(),
      outcome: result.outcome,
      duration_ms: result.duration_ms,
      tokens_input: result.tokens_input,
      tokens_output: result.tokens_output,
      cost_credits: result.cost_credits,
      agent_job_id: result.agent_job_id,
      director_turn_id: result.director_turn_id,
      failure_class: result.failure_class,
      error_message: result.error_message,
      metadata: result.metadata,
    })
    .eq('id', rowId)

  return { id: rowId, result }
}

async function dispatchProbe(probeId: ProbeId): Promise<ProbeRunResult> {
  switch (probeId) {
    case 'director_small':
      return await runDirectorSmall()
    case 'workflow_expand': {
      // V1.x-F.3 — real implementation against the probe-fixture data
      // seeded by scripts/seed-probe-fixtures.ts. Returns the
      // probe_fixtures_not_seeded fail-shape gracefully when the
      // platform_config pointers are absent.
      const { runWorkflowExpandProbe } = await import('./workflow-expand')
      return await runWorkflowExpandProbe()
    }
    case 'refine_accept': {
      // V1.x-F.3 — see above for fixture-gating semantics.
      const { runRefineAcceptProbe } = await import('./refine-accept')
      return await runRefineAcceptProbe()
    }
  }
}

/**
 * director_small — minimal Anthropic ping. Uses Haiku via the cheapest
 * available config; bypasses the LLMProvider abstraction (probe is
 * synthetic substrate verification, not author-facing).
 *
 * Records duration + token counts; cost is left null (tiny + irrelevant
 * for liveness probe; rollup includes it via metrics anyway).
 */
async function runDirectorSmall(): Promise<ProbeRunResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      outcome: 'fail',
      duration_ms: 0,
      tokens_input: null,
      tokens_output: null,
      cost_credits: null,
      agent_job_id: null,
      director_turn_id: null,
      failure_class: 'E',
      error_message: 'ANTHROPIC_API_KEY env not set',
      metadata: null,
    }
  }

  const client = new Anthropic({ apiKey })
  const startedAt = Date.now()
  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Reply with just "OK".' }],
    })
    const duration = Date.now() - startedAt
    return {
      outcome: 'pass',
      duration_ms: duration,
      tokens_input: response.usage.input_tokens,
      tokens_output: response.usage.output_tokens,
      cost_credits: null,
      agent_job_id: null,
      director_turn_id: null,
      failure_class: null,
      error_message: null,
      metadata: {
        model: response.model,
        stop_reason: response.stop_reason,
      },
    }
  } catch (err) {
    return {
      outcome: 'fail',
      duration_ms: Date.now() - startedAt,
      tokens_input: null,
      tokens_output: null,
      cost_credits: null,
      agent_job_id: null,
      director_turn_id: null,
      failure_class: 'E',
      error_message: err instanceof Error ? err.message : String(err),
      metadata: null,
    }
  }
}

// V1.x-F.3 — pendingImplementation() helper removed; workflow_expand
// and refine_accept now dispatch to lib/admin/probes/workflow-expand.ts
// + lib/admin/probes/refine-accept.ts. Probe-fixture-not-seeded case is
// surfaced by those implementations directly with a clear remediation
// hint.
