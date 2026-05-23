/**
 * Agent job lifecycle helpers — shared between the background runner
 * (`runAgentJob` via Vercel waitUntil) and the foreground inline runner
 * (`runAgentJobInline` for SSE — Phase 5c).
 *
 * Source: stelavox_phase5c_build_checklist_v1_0.md §3 T-2.
 *
 * The background path was implemented in Phase 5 (`lib/agent/runner.ts`);
 * Phase 5c factors its DB-transition logic into this module so both paths
 * produce byte-for-byte identical lifecycle writes. The Phase 5b TC-A-15
 * test (`tests/director/j5-workflow-approve.spec.ts`) is the regression
 * gate — it exercises the whole background path including SU-48 catch-up.
 */

import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { advanceWorkflow } from '@/lib/director/workflow-executor'
import { assembleContext, type AssemblerProfile } from '@/lib/llm/context-assembler'
import type { AssembledPrompt, TokenUsage } from '@/lib/llm/types'
import { createServiceRoleClient } from '@/lib/supabase/service'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface AgentJobRow {
  id: string
  organisation_id: string
  node_id: string | null
  operation_type: string
  profile_id: string | null
  status: string
  triggered_by: string
  context_snapshot: Record<string, unknown> | null
}

export interface AgentProfileRow {
  id: string
  name: string
  operation_type: string
  node_type: string
  system_prompt: string
  model_id: string
  temperature: number
  max_tokens: number
  context_rules: Record<string, unknown>
}

export interface DynamicContext {
  agent_instruction?: string
  target_field?: string
  refinement_instruction?: string
  target_layer_count?: number
  prose_target_words?: number
}

// ---------------------------------------------------------------------------
// Workflow-step dispatch helpers
// ---------------------------------------------------------------------------

/**
 * Phase 5b SU-40 — extract workflow_id from `triggered_by` if it encodes a
 * workflow step (format: `workflow_step:<step_id>:<workflow_id>`).
 */
export function workflowIdFromTriggeredBy(
  triggeredBy: string | null | undefined,
): string | null {
  if (!triggeredBy) return null
  if (!triggeredBy.startsWith('workflow_step:')) return null
  const parts = triggeredBy.split(':')
  return parts.length >= 3 ? parts[2] : null
}

export async function notifyWorkflowIfStep(
  triggeredBy: string | null | undefined,
): Promise<void> {
  const workflowId = workflowIdFromTriggeredBy(triggeredBy)
  if (!workflowId) return
  try {
    await advanceWorkflow(workflowId)
  } catch (err) {
    console.error('[agent-runner] advanceWorkflow failed', {
      workflowId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// Job loading + validation
// ---------------------------------------------------------------------------

export type LoadJobOutcome =
  | { kind: 'ok'; job: AgentJobRow; profile: AgentProfileRow; dynamicCtx: DynamicContext }
  | { kind: 'job_not_found' }
  | { kind: 'job_not_pending'; status: string }
  | { kind: 'job_missing_profile_or_node' }
  | { kind: 'agent_profile_not_found' }

/**
 * Load the agent_job + its profile, validate the row is in a runnable state,
 * extract the dynamicCtx slice from context_snapshot. Returns a discriminated
 * union — caller dispatches `markJobFailed` or proceeds.
 */
export async function loadJobAndProfile(
  supabase: SupabaseClient,
  jobId: string,
): Promise<LoadJobOutcome> {
  const { data: job, error: jobErr } = await supabase
    .from('agent_jobs')
    .select(
      'id, organisation_id, node_id, operation_type, profile_id, status, triggered_by, context_snapshot',
    )
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    return { kind: 'job_not_found' }
  }
  if (job.status !== 'pending') {
    return { kind: 'job_not_pending', status: job.status }
  }
  if (!job.profile_id || !job.node_id) {
    return { kind: 'job_missing_profile_or_node' }
  }

  const { data: profile, error: profileErr } = await supabase
    .from('agent_profiles')
    .select(
      'id, name, operation_type, node_type, system_prompt, model_id, temperature, max_tokens, context_rules',
    )
    .eq('id', job.profile_id)
    .maybeSingle()

  if (profileErr || !profile) {
    return { kind: 'agent_profile_not_found' }
  }

  const dynamicCtx = (job.context_snapshot?.dynamic ?? {}) as DynamicContext
  return {
    kind: 'ok',
    job: job as AgentJobRow,
    profile: profile as AgentProfileRow,
    dynamicCtx,
  }
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

/**
 * Mark the job 'running' + start heartbeat field. Returns false if the
 * UPDATE didn't match (e.g. someone cancelled the job between insert and
 * runner start) — caller should bail.
 */
export async function persistRunningStart(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  // Apollo Phase 3 migration: delegate to the orchestration module.
  // Two legal transition events:
  //   * dispatcher_cas_claim then persist_running_start (dispatched→running)
  //   * runner_start_bypass (queued→running, workflow-executor bypass path)
  // We don't know which path the caller is on, so first attempt the
  // canonical "after-dispatcher" transition; if that fails (job was
  // already queued because of the bypass path), attempt the bypass.
  // The DB trigger refuses any illegal transition.
  const { markAgentJobRunning } = await import('@/lib/orchestration')

  // Try the dispatched→running path first.
  let result = await markAgentJobRunning(supabase, jobId, { bypassDispatcher: false })
  if (result.ok) return true

  // Fall back to queued→running (bypass path).
  result = await markAgentJobRunning(supabase, jobId, { bypassDispatcher: true })
  if (result.ok) return true

  // Both failed — row didn't match the expected prior state.
  if (result.error === 'illegal_transition') {
    // Job was likely already cancelled or in another terminal state.
    return false
  }
  console.error('[agent-lifecycle] persistRunningStart: orchestration transition failed', { jobId, error: result.error, message: result.message })
  return false
}

/**
 * Assemble the prompt (calls assembleContext) and persist it onto the
 * agent_job's context_snapshot column (immutable per API Contract §2.11
 * invariant 8 — set once, then read-only). Returns the assembled prompt.
 */
export async function assembleAndPersistContext(
  supabase: SupabaseClient,
  job: AgentJobRow,
  profile: AgentProfileRow,
  dynamicCtx: DynamicContext,
): Promise<AssembledPrompt> {
  if (!job.node_id) throw new Error('job_missing_node_id')
  const assembled = await assembleContext(
    supabase,
    job.node_id,
    profile as AssemblerProfile,
    dynamicCtx.agent_instruction ?? '',
  )

  await supabase
    .from('agent_jobs')
    .update({
      context_snapshot: {
        ...(job.context_snapshot ?? {}),
        assembled_at: new Date().toISOString(),
        stable: assembled.stable,
        dynamic: { ...assembled.dynamic, ...dynamicCtx },
        config: assembled.config,
      },
    })
    .eq('id', job.id)

  return assembled
}

export interface FinalResultParams {
  resultColumns: Record<string, unknown>
  usage: TokenUsage
  modelId: string
  provider: string
  costUsd: number
  /**
   * V1.x-C.1.b — credits cost from `pricing_rates`. Written to
   * `agent_jobs.cost_credits` (column shipped in B.2.1 M-105). May be
   * null when the rate lookup returns no row; callers log + continue
   * rather than fail the job (a missing credit rate is recoverable —
   * usage tracking proceeds at zero credit cost for that job).
   */
  costCredits?: number | null
}

/**
 * Terminal write — sets status='completed' atomically with all result
 * columns + token totals + cost. Will NOT clobber a 'cancelled' row
 * (last-line cancellation guard via .neq('status','cancelled')).
 */
export async function persistFinalResult(
  supabase: SupabaseClient,
  jobId: string,
  params: FinalResultParams,
): Promise<void> {
  // Apollo Phase 3 migration: delegate to the orchestration module.
  // Transition: running → awaiting_accept. The runner has completed
  // its LLM call; the work is now awaiting author Accept (for
  // content-modifying ops) or auto-accept by advanceWorkflow's
  // catch-up.
  const { markAgentJobAwaitingAccept } = await import('@/lib/orchestration')
  await markAgentJobAwaitingAccept(supabase, jobId, {
    resultColumns: params.resultColumns,
    tokensInput: params.usage.tokens_input,
    tokensOutput: params.usage.tokens_output,
    tokensCacheWrite: params.usage.tokens_cache_write,
    tokensCacheRead: params.usage.tokens_cache_read,
    modelId: params.modelId,
    provider: params.provider,
    costUsd: params.costUsd,
    costCredits: params.costCredits ?? null,
  })
}

/**
 * Mark a job 'failed' with an error message. Reads `triggered_by` first
 * so the workflow continuation chain (SU-40) can be notified after.
 */
export async function persistFailure(
  supabase: SupabaseClient,
  jobId: string,
  errorMessage: string,
): Promise<void> {
  const { data: jobBefore } = await supabase
    .from('agent_jobs')
    .select('triggered_by')
    .eq('id', jobId)
    .maybeSingle()

  // Apollo Phase 3: delegate. Transition: running → failed.
  const { markAgentJobFailed } = await import('@/lib/orchestration')
  await markAgentJobFailed(supabase, jobId, errorMessage, 'A')

  await notifyWorkflowIfStep(jobBefore?.triggered_by)
}

/**
 * Mark a job 'cancelled' with a reason. Phase 5c uses this when the SSE
 * client disconnects mid-stream. Idempotent: if the job is already in a
 * terminal state, the UPDATE matches no rows.
 */
export async function persistCancellation(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<void> {
  const { data: jobBefore } = await supabase
    .from('agent_jobs')
    .select('triggered_by')
    .eq('id', jobId)
    .maybeSingle()

  // Apollo Phase 3: delegate. Transition: {queued|dispatched|running} → cancelled.
  // markAgentJobCancelled is keyed on 'cancel_mid_run' (running → cancelled);
  // for queued/dispatched paths the dispatcher's stop-cascade is the
  // canonical entry. This is the SSE-disconnect path so the row is
  // typically in 'running'.
  const { markAgentJobCancelled } = await import('@/lib/orchestration')
  await markAgentJobCancelled(supabase, jobId, reason)

  await notifyWorkflowIfStep(jobBefore?.triggered_by)
}

/**
 * Re-read the job's status — used as a cancel-check before result write.
 * Returns true iff the row is currently 'cancelled'.
 */
export async function isJobCancelled(
  supabase: SupabaseClient,
  jobId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('agent_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle()
  return data?.status === 'cancelled'
}

/**
 * Cancellation-aware token write — used when we want to record tokens
 * consumed by an LLM call that ran to completion BUT the job was cancelled
 * before the result was committed. Avoids losing the billing signal.
 */
export async function recordTokensOnly(
  supabase: SupabaseClient,
  jobId: string,
  usage: TokenUsage,
  modelId: string,
  provider: string,
): Promise<void> {
  await supabase
    .from('agent_jobs')
    .update({
      tokens_input: usage.tokens_input,
      tokens_output: usage.tokens_output,
      tokens_cache_write: usage.tokens_cache_write,
      tokens_cache_read: usage.tokens_cache_read,
      model_id: modelId,
      provider: provider,
    })
    .eq('id', jobId)
}

// ---------------------------------------------------------------------------
// Usage records (per-org, per-month, per-operation, per-provider)
// ---------------------------------------------------------------------------

function formatYearMonth(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export async function updateUsageRecords(
  organisationId: string,
  operationType: string,
  provider: string,
  usage: TokenUsage,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const yearMonth = formatYearMonth(new Date())

  const { data: existing } = await supabase
    .from('usage_records')
    .select('id, tokens_input, tokens_output, tokens_cache_write, tokens_cache_read')
    .eq('organisation_id', organisationId)
    .eq('year_month', yearMonth)
    .eq('operation_type', operationType)
    .eq('provider', provider)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('usage_records')
      .update({
        tokens_input: (existing.tokens_input ?? 0) + usage.tokens_input,
        tokens_output: (existing.tokens_output ?? 0) + usage.tokens_output,
        tokens_cache_write: (existing.tokens_cache_write ?? 0) + usage.tokens_cache_write,
        tokens_cache_read: (existing.tokens_cache_read ?? 0) + usage.tokens_cache_read,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
  } else {
    await supabase.from('usage_records').insert({
      organisation_id: organisationId,
      year_month: yearMonth,
      operation_type: operationType,
      provider: provider,
      tokens_input: usage.tokens_input,
      tokens_output: usage.tokens_output,
      tokens_cache_write: usage.tokens_cache_write,
      tokens_cache_read: usage.tokens_cache_read,
    })
  }
}
