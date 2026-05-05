/**
 * Agent runner — the async LLM-call dispatcher.
 *
 * Source: stelavox_phase5_api_contract_v1_0.md v1.2 §2.11.
 *         stelavox_technical_architecture_v1_8.md §6.1.
 * Build Checklist T-7.1 (with SU-28 — implemented as a Next.js function
 * invoked via waitUntil() rather than a Supabase Edge Function; spec
 * deviation captured for TA close-out absorption).
 *
 * Called by the four agent operation API routes via Vercel's waitUntil()
 * so the routes return 202 Accepted immediately while this function does
 * the LLM work in the background.
 *
 * Per API Contract §2.11 invariant 9 (Edge Function half):
 *   1. UPDATE agent_jobs SET status='running'
 *   2. Load profile + node + ancestors + linked context + comments
 *   3. Extract Tiptap content as plain text (H-06)
 *   4. Inject canary, assemble prompt with security frame
 *   5. Write context_snapshot
 *   6. Call LLM via lib/llm/factory
 *   7. Scan response for canary leak
 *   8. Validate response against Zod schema
 *   9. Compute cost_usd
 *  10. Re-read status — if 'cancelled', exit clean
 *  11. Write result_* columns
 *  12. Update usage_records
 *  13. UPDATE agent_jobs SET status='completed'
 *
 * On any thrown error: catches, sets status='failed', writes
 * error_message, real-time fires.
 */

import 'server-only'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { assembleContext, InjectionDetectedError, type AssemblerProfile } from '@/lib/llm/context-assembler'
import { computeCostUsd } from '@/lib/llm/cost'
import { getProvider } from '@/lib/llm/factory'
import type { TokenUsage } from '@/lib/llm/types'
import { SecurityViolationError } from '@/lib/security/canary'
import { runExpand } from '@/lib/agent/operations/expand'
import { runSynthesise } from '@/lib/agent/operations/synthesise'
import { runRefine } from '@/lib/agent/operations/refine'
import { runGenerateContext } from '@/lib/agent/operations/generate-context'

export interface AgentJobRow {
  id: string
  organisation_id: string
  node_id: string | null
  operation_type: string
  profile_id: string | null
  status: string
  triggered_by: string
  context_snapshot: Record<string, unknown> | null
  // Refine-specific (carried via context_snapshot.dynamic on Phase 5)
  // Cancellation-aware fields:
  // ... see Migration 026 for full row shape
}

/**
 * Runner entry point. Loads the job by ID and dispatches.
 * On any error, marks the job failed with error_message.
 */
export async function runAgentJob(jobId: string): Promise<void> {
  const supabase = createServiceRoleClient()

  // 1. Load job
  const { data: job, error: jobErr } = await supabase
    .from('agent_jobs')
    .select('id, organisation_id, node_id, operation_type, profile_id, status, triggered_by, context_snapshot')
    .eq('id', jobId)
    .maybeSingle()

  if (jobErr || !job) {
    console.error('[agent-runner] job not found', { jobId, error: jobErr?.message })
    return
  }

  if (job.status !== 'pending') {
    console.warn('[agent-runner] job not in pending state, skipping', { jobId, status: job.status })
    return
  }

  if (!job.profile_id || !job.node_id) {
    await markJobFailed(jobId, 'job_missing_profile_or_node')
    return
  }

  // 2. Load profile
  const { data: profile, error: profileErr } = await supabase
    .from('agent_profiles')
    .select('id, name, operation_type, node_type, system_prompt, model_id, temperature, max_tokens, context_rules')
    .eq('id', job.profile_id)
    .maybeSingle()

  if (profileErr || !profile) {
    await markJobFailed(jobId, 'agent_profile_not_found')
    return
  }

  // 3. Set status='running'
  const { error: runErr } = await supabase
    .from('agent_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('status', 'pending')

  if (runErr) {
    console.error('[agent-runner] failed to set running', { jobId, error: runErr.message })
    return
  }

  // 4. Dispatch to per-operation module
  try {
    const dynamicCtx = (job.context_snapshot?.dynamic ?? {}) as {
      agent_instruction?: string
      target_field?: string
      refinement_instruction?: string
      target_layer_count?: number
      prose_target_words?: number
    }

    const assembled = await assembleContext(
      supabase,
      job.node_id,
      profile as AssemblerProfile,
      dynamicCtx.agent_instruction ?? '',
    )

    // Write context_snapshot (immutable per API Contract §2.11 invariant 8)
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
      .eq('id', jobId)

    // Call the LLM via the factory
    const { provider, modelId } = await getProvider(
      { id: job.organisation_id }, // V1 BYOK fields all undefined
      profile.operation_type,
      profile.model_id,
    )
    const llmResponse = await provider.complete({
      ...assembled,
      config: { ...assembled.config, model: modelId },
    })

    // Cancellation check #1 — before result write
    if (await isJobCancelled(jobId)) {
      // Still record tokens consumed
      await recordTokensOnly(jobId, llmResponse.usage, llmResponse.model, llmResponse.provider)
      return
    }

    // Compute cost (frozen at this moment)
    const costUsd = await computeCostUsd(llmResponse.usage, llmResponse.model)

    // Dispatch by operation type — module validates schema and computes result_*
    const resultColumns = await runOperation(
      profile.operation_type,
      llmResponse.content,
      dynamicCtx.target_field,
    )

    // Cancellation check #2 — before final write
    if (await isJobCancelled(jobId)) {
      await recordTokensOnly(jobId, llmResponse.usage, llmResponse.model, llmResponse.provider)
      return
    }

    // Final write: result_* + tokens + cost + status
    await supabase
      .from('agent_jobs')
      .update({
        ...resultColumns,
        tokens_input: llmResponse.usage.tokens_input,
        tokens_output: llmResponse.usage.tokens_output,
        tokens_cache_write: llmResponse.usage.tokens_cache_write,
        tokens_cache_read: llmResponse.usage.tokens_cache_read,
        model_id: llmResponse.model,
        provider: llmResponse.provider,
        cost_usd: costUsd,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .neq('status', 'cancelled') // last-line cancellation guard

    // Update usage_records (atomic upsert into the current period)
    await updateUsageRecords(
      job.organisation_id,
      profile.operation_type,
      llmResponse.provider,
      llmResponse.usage,
    )
  } catch (err) {
    if (err instanceof InjectionDetectedError) {
      await markJobFailed(jobId, `injection_blocked:${err.fieldName}`)
    } else if (err instanceof SecurityViolationError) {
      await markJobFailed(jobId, 'canary_leak_detected')
    } else if (err instanceof Error) {
      await markJobFailed(jobId, err.message)
      // T-15 debug aid: when output schema validation fails, the raw LLM
      // response is the most useful signal for prompt iteration. Log it
      // to console so the dev server output shows what came back.
      if (err.message.includes('output_schema_invalid')) {
        console.error('[agent-runner] Zod validation failed for job', jobId, 'error:', err.message)
      }
    } else {
      await markJobFailed(jobId, 'unknown_error')
    }
  }
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

async function isJobCancelled(jobId: string): Promise<boolean> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('agent_jobs')
    .select('status')
    .eq('id', jobId)
    .maybeSingle()
  return data?.status === 'cancelled'
}

async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  const supabase = createServiceRoleClient()
  await supabase
    .from('agent_jobs')
    .update({
      status: 'failed',
      error_message: errorMessage,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .neq('status', 'cancelled')
}

async function recordTokensOnly(
  jobId: string,
  usage: TokenUsage,
  modelId: string,
  provider: string,
): Promise<void> {
  const supabase = createServiceRoleClient()
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

async function updateUsageRecords(
  organisationId: string,
  operationType: string,
  provider: string,
  usage: TokenUsage,
): Promise<void> {
  const supabase = createServiceRoleClient()
  const yearMonth = formatYearMonth(new Date())

  // Read existing row (if any) and upsert with incremented totals.
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

function formatYearMonth(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}
