/**
 * Agent runner — the async LLM-call dispatcher (background path).
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_technical_architecture_v2_1.md §6.1.
 *
 * Called by the four agent operation API routes via Vercel's waitUntil()
 * so the routes return 202 Accepted immediately while this function does
 * the LLM work in the background.
 *
 * Phase 5c factoring (T-2): the DB-transition helpers
 * (`loadJobAndProfile`, `persistRunningStart`, `assembleAndPersistContext`,
 * `persistFinalResult`, `persistFailure`, `recordTokensOnly`,
 * `updateUsageRecords`, `notifyWorkflowIfStep`, `isJobCancelled`) are now
 * shared with `runAgentJobInline` for the Phase 5c streaming path. Both
 * paths produce byte-for-byte identical lifecycle writes — the only
 * difference is `runAgentJob` calls `provider.complete()` while
 * `runAgentJobInline` calls `provider.stream()` and accumulates text
 * deltas before composing the same `result_columns` shape.
 */

import 'server-only'

import { runExpand } from '@/lib/agent/operations/expand'
import { runGenerateContext } from '@/lib/agent/operations/generate-context'
import { runRefine } from '@/lib/agent/operations/refine'
import { runSynthesise } from '@/lib/agent/operations/synthesise'
import {
  assembleAndPersistContext,
  isJobCancelled,
  loadJobAndProfile,
  notifyWorkflowIfStep,
  persistCancellation,
  persistFailure,
  persistFinalResult,
  persistRunningStart,
  recordTokensOnly,
  updateUsageRecords,
} from '@/lib/agent/job-lifecycle'
import { getConfigInt } from '@/lib/config/platform-config'
import { computeCompletionCredits } from '@/lib/cost/completionCredits'
import { startHeartbeat } from '@/lib/director/heartbeat'
import { InjectionDetectedError } from '@/lib/llm/context-assembler'
import { computeCostUsd } from '@/lib/llm/cost'
import { getProvider } from '@/lib/llm/factory'
import type { TokenUsage } from '@/lib/llm/types'
import { SecurityViolationError } from '@/lib/security/canary'
import { createServiceRoleClient } from '@/lib/supabase/service'

/**
 * Runner entry point. Loads the job by ID and dispatches.
 * On any error, marks the job failed with error_message.
 */
export async function runAgentJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient()

  // 1. Load + validate job + profile
  const loaded = await loadJobAndProfile(supabase, jobId)
  if (loaded.kind === 'job_not_found') {
    console.error('[agent-runner] job not found', { jobId })
    return
  }
  if (loaded.kind === 'job_not_pending') {
    console.warn('[agent-runner] job not in pending state, skipping', {
      jobId,
      status: loaded.status,
    })
    return
  }
  if (loaded.kind === 'job_missing_profile_or_node') {
    await persistFailure(supabase, jobId, 'job_missing_profile_or_node')
    return
  }
  if (loaded.kind === 'agent_profile_not_found') {
    await persistFailure(supabase, jobId, 'agent_profile_not_found')
    return
  }
  const { job, profile, dynamicCtx } = loaded

  // 2. Set status='running' + last_heartbeat_at
  const claimed = await persistRunningStart(supabase, jobId)
  if (!claimed) {
    console.error('[agent-runner] failed to claim job (race?)', { jobId })
    return
  }

  // 3. Heartbeat — runs every agent.heartbeat_interval_ms (default 5000ms)
  // until the finally block clears it.
  const heartbeatIntervalMs = await getConfigInt('agent.heartbeat_interval_ms')
  const stopHeartbeat = startHeartbeat(async () => {
    await supabase
      .from('agent_jobs')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'running')
  }, heartbeatIntervalMs)

  // 4. Dispatch
  try {
    // Assemble the prompt + persist context_snapshot (immutable).
    const assembled = await assembleAndPersistContext(supabase, job, profile, dynamicCtx)

    // V1.x-B.2.3 — extract user_id from triggered_by when present, so
    // the factory can route via ByokProvider when the user has a
    // per-user Anthropic key. The triggered_by field is one of:
    //   - a UUID (user-triggered jobs) → use as user_id for BYOK lookup
    //   - 'workflow_step:<step_id>:<workflow_id>' → workflow-driven; user
    //     unknown at runner time, falls back to platform route
    //   - 'scheduled' / 'integration-test' / etc. → not a UUID; platform route
    const userIdForByok = isUuidLike(job.triggered_by) ? job.triggered_by : undefined

    // Call the LLM via the factory.
    const { provider, modelId, route } = await getProvider(
      { id: job.organisation_id },
      profile.operation_type,
      profile.model_id,
      userIdForByok,
    )

    // Stamp `route` for metrics + bucket selection. The factory tells
    // us whether this resolved to platform or byok routing.
    await supabase
      .from('agent_jobs')
      .update({ route })
      .eq('id', jobId)
      .in('queue_status', ['queued', 'dispatched', 'running'])
    const llmResponse = await provider.complete({
      ...assembled,
      config: { ...assembled.config, model: modelId },
    })

    // Cancellation check #1 — before result computation.
    if (await isJobCancelled(supabase, jobId)) {
      await recordTokensOnly(
        supabase,
        jobId,
        llmResponse.usage,
        llmResponse.model,
        llmResponse.provider,
      )
      return
    }

    // Compute cost (frozen at this moment) + result columns. V1.x-C.1.b
    // computes BOTH dollars (anthropic_pricing → cost_usd) and credits
    // (pricing_rates → cost_credits) at completion. Credits lookup is
    // tolerant: null on missing rate, logged + written as NULL on the
    // row (matches FinalResultParams contract).
    // Model Governance P0 — credits are GUARANTEED non-null (fallback debit +
    // critical audit on the should-never-happen unpriced case), so usage can
    // never go unmetered. cost_usd is derived from credits when the $-rate is
    // missing (credits are micro-dollars; 1M credits = $1).
    const { credits: costCredits } = await computeCompletionCredits(
      supabase,
      llmResponse.model,
      new Date(),
      {
        input: llmResponse.usage.tokens_input,
        output: llmResponse.usage.tokens_output,
        cacheWrite: llmResponse.usage.tokens_cache_write,
        cacheRead: llmResponse.usage.tokens_cache_read,
      },
      { jobId, organisationId: job.organisation_id },
    )
    let costUsd: number
    try {
      costUsd = await computeCostUsd(llmResponse.usage, llmResponse.model)
    } catch {
      costUsd = costCredits / 1_000_000
    }
    let resultColumns: Record<string, unknown>
    let totalUsage = { ...llmResponse.usage }
    let totalCost = costUsd
    let totalCostCredits: number = costCredits
    let finalContent = llmResponse.content
    let finalProvider = llmResponse.provider
    let finalModel = llmResponse.model
    try {
      resultColumns = await runOperation(
        profile.operation_type,
        llmResponse.content,
        dynamicCtx.target_field,
      )
    } catch (parseErr) {
      // SU-J14-3 (round-3 drive 2026-05-09): the LLM occasionally emits
      // a response shape the parser can't accept (no JSON array, malformed
      // mid-object, etc.). Before round 3 this failed the job hard. Now
      // we retry the LLM call ONCE before giving up. The model is
      // non-deterministic; one extra call resolves the common case.
      // Only retry on output_schema_invalid (parser/validator failures);
      // injection_blocked, canary_leak, network errors all fail straight.
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
      if (!msg.includes('output_schema_invalid') && !msg.includes('model_output_truncated')) {
        throw parseErr
      }
      console.warn('[agent-runner] retrying once after parse failure:', msg)
      const retry = await provider.complete({
        ...assembled,
        config: { ...assembled.config, model: modelId },
      })
      const { credits: retryCredits } = await computeCompletionCredits(
        supabase,
        retry.model,
        new Date(),
        {
          input: retry.usage.tokens_input,
          output: retry.usage.tokens_output,
          cacheWrite: retry.usage.tokens_cache_write,
          cacheRead: retry.usage.tokens_cache_read,
        },
        { jobId, organisationId: job.organisation_id },
      )
      let retryCost: number
      try {
        retryCost = await computeCostUsd(retry.usage, retry.model)
      } catch {
        retryCost = retryCredits / 1_000_000
      }
      // Track BOTH calls' usage and cost so the author sees the true spend.
      totalUsage = {
        tokens_input: llmResponse.usage.tokens_input + retry.usage.tokens_input,
        tokens_output: llmResponse.usage.tokens_output + retry.usage.tokens_output,
        tokens_cache_write:
          llmResponse.usage.tokens_cache_write + retry.usage.tokens_cache_write,
        tokens_cache_read:
          llmResponse.usage.tokens_cache_read + retry.usage.tokens_cache_read,
      }
      totalCost = costUsd + retryCost
      // Both legs guarantee a credit value — sum is always real (never null).
      totalCostCredits = costCredits + retryCredits
      finalContent = retry.content
      finalProvider = retry.provider
      finalModel = retry.model
      resultColumns = await runOperation(
        profile.operation_type,
        retry.content,
        dynamicCtx.target_field,
      )
    }

    // Cancellation check #2 — before final write.
    if (await isJobCancelled(supabase, jobId)) {
      await recordTokensOnly(
        supabase,
        jobId,
        totalUsage,
        finalModel,
        finalProvider,
      )
      return
    }

    // Final write: result_* + tokens + cost + status='completed'.
    void finalContent  // referenced in retry-aware logging only
    await persistFinalResult(supabase, jobId, {
      resultColumns,
      usage: totalUsage,
      modelId: finalModel,
      provider: finalProvider,
      costUsd: totalCost,
      costCredits: totalCostCredits,
    })

    // Update usage_records.
    await updateUsageRecords(
      job.organisation_id,
      profile.operation_type,
      finalProvider,
      totalUsage,
    )
  } catch (err) {
    if (err instanceof InjectionDetectedError) {
      await persistFailure(supabase, jobId, `injection_blocked:${err.fieldName}`)
    } else if (err instanceof SecurityViolationError) {
      await persistFailure(supabase, jobId, 'canary_leak_detected')
    } else if (err instanceof Error) {
      await persistFailure(supabase, jobId, err.message)
      // T-15 debug aid: when output schema validation fails, the raw LLM
      // response is the most useful signal for prompt iteration.
      if (err.message.includes('output_schema_invalid')) {
        console.error('[agent-runner] Zod validation failed for job', jobId, 'error:', err.message)
      }
    } else {
      await persistFailure(supabase, jobId, 'unknown_error')
    }
    // DR-096 (audit F-56), Phase 9.1 — background-runner failures were
    // visible only on the agent_jobs row (status='failed'), not in the
    // forensic audit_log. Now every failure also lands an audit entry.
    // (Injection + canary paths already write their own entries inside
    // the scanner/canary modules; this catch-all covers the rest, and a
    // doubled entry for those two classes is harmless.)
    {
      const message = err instanceof Error ? err.message : 'unknown_error'
      const { writeAuditLogEntry } = await import('@/lib/security/audit')
      await writeAuditLogEntry({
        event_type: 'agent_job_failed',
        severity: 'medium',
        organisation_id: job.organisation_id,
        node_id: job.node_id,
        metadata: { job_id: jobId, operation_type: profile.operation_type, error: message },
      })
    }
  } finally {
    stopHeartbeat()
  }

  // Phase 5b SU-40: workflow continuation chain. The completed/failed
  // path already calls notifyWorkflowIfStep via persistFailure on errors;
  // the success path needs an explicit call here.
  await notifyWorkflowIfStep(job.triggered_by)
}

async function runOperation(
  operationType: string,
  content: string,
  targetField?: string,
): Promise<Record<string, unknown>> {
  switch (operationType) {
    case 'expand':
      return runExpand(content)
    case 'synthesise':
      return runSynthesise(content)
    case 'refine':
      return runRefine(content, targetField)
    case 'generate_context':
      return runGenerateContext(content)
    default:
      throw new Error(`unknown operation_type: ${operationType}`)
  }
}

// ---------------------------------------------------------------------------
// Phase 5c — runAgentJobInline (foreground SSE path)
// ---------------------------------------------------------------------------

export type InlineRunnerEvent =
  | {
      type: 'job_created'
      payload: { agent_job_id: string; node_id: string; profile_id: string }
    }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'usage'
      payload: {
        tokens_input: number
        tokens_output: number
        tokens_cache_read: number
        tokens_cache_write: number
        cost_usd: number
        model_id: string
      }
    }
  | {
      type: 'job_complete'
      payload: {
        agent_job_id: string
        result_prose: string
        tokens_input: number
        tokens_output: number
        cost_usd: number
      }
    }
  | { type: 'error'; error: string; message: string }

/**
 * Foreground synthesise runner — yields events suitable for piping into
 * an SSE response. Phase 5c Build Checklist §3 T-3.
 *
 * The caller (the SSE route) is responsible for INSERTing the agent_jobs
 * row in 'pending' state before calling this generator. This runner then
 * loads the job, transitions it to 'running', streams from the provider,
 * accumulates the prose, and persists the terminal result.
 *
 * Cancellation: when the SSE consumer disconnects, the route's for-await
 * loop breaks. That triggers `generator.return()` on this generator, which
 * runs the finally block. The fallback `persistCancellation` call there
 * marks the job 'cancelled' — idempotent against any other terminal state
 * (the UPDATE filters by status IN ('running','pending')).
 *
 * Operation-type guard: this runner only handles `synthesise`. Other
 * operation types still go through `runAgentJob` (background path).
 */
export async function* runAgentJobInline(
  jobId: string,
): AsyncGenerator<InlineRunnerEvent> {
  const supabase = createServiceRoleClient()

  // 1. Load + validate job + profile
  const loaded = await loadJobAndProfile(supabase, jobId)
  if (loaded.kind !== 'ok') {
    if (loaded.kind === 'job_missing_profile_or_node') {
      await persistFailure(supabase, jobId, 'job_missing_profile_or_node')
    } else if (loaded.kind === 'agent_profile_not_found') {
      await persistFailure(supabase, jobId, 'agent_profile_not_found')
    }
    yield {
      type: 'error',
      error: loaded.kind,
      message:
        loaded.kind === 'job_not_pending'
          ? `job is in '${loaded.status}' state, not pending`
          : loaded.kind,
    }
    return
  }
  const { job, profile, dynamicCtx } = loaded

  if (profile.operation_type !== 'synthesise') {
    await persistFailure(
      supabase,
      jobId,
      `unsupported_streaming_op:${profile.operation_type}`,
    )
    yield {
      type: 'error',
      error: 'unsupported_streaming_op',
      message: `streaming inline runner only supports synthesise; got ${profile.operation_type}`,
    }
    return
  }

  // 2. Claim the job — atomic transition pending → running.
  const claimed = await persistRunningStart(supabase, jobId)
  if (!claimed) {
    yield {
      type: 'error',
      error: 'job_not_claimable',
      message: 'job already in non-pending state when runner started',
    }
    return
  }

  // 3. Yield job_created event (the route relays this as agent_job_created).
  yield {
    type: 'job_created',
    payload: {
      agent_job_id: jobId,
      node_id: job.node_id!,
      profile_id: job.profile_id!,
    },
  }

  // 4. Heartbeat — same cadence as the background path.
  const heartbeatIntervalMs = await getConfigInt('agent.heartbeat_interval_ms')
  const stopHeartbeat = startHeartbeat(async () => {
    await supabase
      .from('agent_jobs')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('id', jobId)
      .eq('status', 'running')
  }, heartbeatIntervalMs)

  let usage: TokenUsage | null = null
  let modelIdUsed: string | null = null
  const providerName = 'anthropic'

  try {
    // 5. Assemble context + persist context_snapshot.
    const assembled = await assembleAndPersistContext(supabase, job, profile, dynamicCtx)

    // 6. Resolve provider + open stream.
    const { provider, modelId } = await getProvider(
      { id: job.organisation_id },
      profile.operation_type,
      profile.model_id,
    )
    if (!provider.stream) {
      throw new Error('provider does not support streaming')
    }
    modelIdUsed = modelId

    let accumulated = ''

    // 7. Iterate the upstream SSE — yield text deltas as they arrive,
    // capture usage on message_stop. Canary scan happens inside the
    // provider on every delta (T-1 acceptance covers this).
    for await (const chunk of provider.stream({
      ...assembled,
      config: { ...assembled.config, model: modelId },
    })) {
      if (chunk.type === 'text' && chunk.text) {
        accumulated += chunk.text
        yield { type: 'text_delta', delta: chunk.text }
      } else if (chunk.type === 'message_stop' && chunk.usage) {
        usage = chunk.usage
      }
    }

    // 8. Cancellation check — if the row was flipped to 'cancelled' while
    // we streamed (e.g. a parallel client cancel), record tokens consumed
    // and exit without writing the result.
    if (await isJobCancelled(supabase, jobId)) {
      if (usage) {
        await recordTokensOnly(supabase, jobId, usage, modelIdUsed, providerName)
      }
      return
    }

    // 9. Validate accumulated prose against the synthesise schema.
    const result = await runSynthesise(accumulated)

    if (!usage) {
      throw new Error('stream ended without usage info')
    }

    // 10. Compute cost + persist final result. Model Governance P0 — credits
    // guaranteed non-null (fallback + critical audit); cost_usd derived from
    // credits when the $-rate is missing.
    const { credits: costCredits } = await computeCompletionCredits(
      supabase,
      modelIdUsed,
      new Date(),
      {
        input: usage.tokens_input,
        output: usage.tokens_output,
        cacheWrite: usage.tokens_cache_write,
        cacheRead: usage.tokens_cache_read,
      },
      { jobId, organisationId: job.organisation_id },
    )
    let costUsd: number
    try {
      costUsd = await computeCostUsd(usage, modelIdUsed)
    } catch {
      costUsd = costCredits / 1_000_000
    }
    await persistFinalResult(supabase, jobId, {
      resultColumns: result,
      usage,
      modelId: modelIdUsed,
      provider: providerName,
      costUsd,
      costCredits,
    })

    // 11. Update usage records.
    await updateUsageRecords(
      job.organisation_id,
      profile.operation_type,
      providerName,
      usage,
    )

    // 12. Yield usage + job_complete (final structured signals).
    yield {
      type: 'usage',
      payload: {
        tokens_input: usage.tokens_input,
        tokens_output: usage.tokens_output,
        tokens_cache_read: usage.tokens_cache_read,
        tokens_cache_write: usage.tokens_cache_write,
        cost_usd: costUsd,
        model_id: modelIdUsed,
      },
    }
    yield {
      type: 'job_complete',
      payload: {
        agent_job_id: jobId,
        result_prose: result.result_prose,
        tokens_input: usage.tokens_input,
        tokens_output: usage.tokens_output,
        cost_usd: costUsd,
      },
    }

    // 13. Workflow continuation chain (no-op for user-triggered jobs;
    // synthesise via streaming never originates from a workflow step in
    // V1, but we call this for parity with the background path).
    await notifyWorkflowIfStep(job.triggered_by)
  } catch (err) {
    let errorCode = 'internal_error'
    let errorMessage = err instanceof Error ? err.message : String(err)

    if (err instanceof InjectionDetectedError) {
      errorCode = 'injection_blocked'
      errorMessage = `injection_blocked:${err.fieldName}`
    } else if (err instanceof SecurityViolationError) {
      errorCode = 'canary_violation'
      errorMessage = 'canary_leak_detected'
    } else if (errorMessage.startsWith('output_schema_invalid')) {
      errorCode = 'output_schema_invalid'
    }

    await persistFailure(supabase, jobId, errorMessage)
    yield { type: 'error', error: errorCode, message: errorMessage }
  } finally {
    stopHeartbeat()
    // Cleanup fallback — if we exited via consumer-side abort
    // (generator.return() before reaching a terminal write), this flips
    // a still-running row to 'cancelled'. Idempotent against any other
    // terminal state (the UPDATE filters status IN ('running','pending')).
    await persistCancellation(supabase, jobId, 'client_disconnect')
  }
}

// ---------------------------------------------------------------------------
// V1.x-B.2.3 helpers
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidLike(s: string | null | undefined): s is string {
  return typeof s === 'string' && UUID_RE.test(s)
}
