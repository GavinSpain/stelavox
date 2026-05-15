import 'server-only'

/**
 * V1.x-B.2.3 — Anthropic Batch API poller.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.2 +
 *         Director Architecture v2.0 §4.4.
 *
 * For each in-progress anthropic_batches row:
 *   1. GET messages.batches.retrieve(batch_id) — refresh status.
 *   2. UPDATE polled_at + poll_count.
 *   3. If status='ended': GET messages.batches.results(batch_id) — JSONL
 *      stream of per-request outcomes; for each result, write back to
 *      the corresponding agent_job (matched by custom_id) using the
 *      same persistFinalResult / persistFailure helpers as the regular
 *      runner.
 *   4. Mark anthropic_batches row completed_at when all per-request
 *      results are processed (or batch-level failure recorded).
 *
 * H-24 (batch-stale-poll) — backfill on first poll after gap. Not
 * implemented in B.2.3 substrate; the per-batch results endpoint is
 * idempotent and returns full results regardless of how long ago the
 * batch ended, so we don't lose results during outages. Backfill
 * concerns reduce to "did we miss any in-progress batches between
 * outages" which is handled by polling all in_progress rows on every
 * tick.
 *
 * Failure semantics:
 *   - Batch-level failure (status='failed' or 'cancelled') → mark all
 *     constituent tickets failed Class A (transient — Anthropic-side
 *     issue, retry-eligible if user resubmits)
 *   - Per-request failure (result.type='errored') → that ticket only
 *     fails (failure_class derived from error code via classify_failure)
 */

import Anthropic from '@anthropic-ai/sdk'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { persistFinalResult, persistFailure } from '@/lib/agent/job-lifecycle'
import { computeCostUsd } from '@/lib/llm/cost'
import { classifyFailure } from './failure-classifier'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PollResult {
  batchesPolled: number
  batchesEnded: number
  ticketsCompleted: number
  ticketsFailed: number
}

export async function pollAllInProgressBatches(): Promise<PollResult> {
  const supabase = createServiceRoleClient()

  const { data: batches } = await supabase
    .from('anthropic_batches')
    .select('id, status, request_count, completed_count, pool_key, poll_count')
    .eq('status', 'in_progress')

  if (!batches || batches.length === 0) {
    return { batchesPolled: 0, batchesEnded: 0, ticketsCompleted: 0, ticketsFailed: 0 }
  }

  let batchesPolled = 0
  let batchesEnded = 0
  let ticketsCompleted = 0
  let ticketsFailed = 0

  for (const b of batches) {
    try {
      const result = await pollOneBatch(b.id, b.pool_key as string)
      batchesPolled++
      if (result.ended) batchesEnded++
      ticketsCompleted += result.ticketsCompleted
      ticketsFailed += result.ticketsFailed
    } catch (err) {
      console.error('[batch-poller] poll failed for batch', b.id, err instanceof Error ? err.message : String(err))
    }
  }

  return { batchesPolled, batchesEnded, ticketsCompleted, ticketsFailed }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function pollOneBatch(
  batchId: string,
  poolKey: string,
): Promise<{ ended: boolean; ticketsCompleted: number; ticketsFailed: number }> {
  const supabase = createServiceRoleClient()

  // BYOK pools deferred to V1.x-C (the BYOK Edge Function pattern needs
  // adapting for batches; B.2.3 substrate ships platform-only).
  if (poolKey !== 'platform') {
    return { ended: false, ticketsCompleted: 0, ticketsFailed: 0 }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set; cannot poll batch')
  }

  const client = new Anthropic({ apiKey })

  // 1. Refresh status.
  const fresh = await client.messages.batches.retrieve(batchId)

  await supabase
    .from('anthropic_batches')
    .update({
      polled_at: new Date().toISOString(),
      poll_count: (await readPollCount(batchId)) + 1,
      status: mapAnthropicStatus(fresh.processing_status),
    })
    .eq('id', batchId)

  if (fresh.processing_status === 'in_progress') {
    return { ended: false, ticketsCompleted: 0, ticketsFailed: 0 }
  }

  // 2. Anthropic batch ended — fetch results.
  let ticketsCompleted = 0
  let ticketsFailed = 0
  let processedCount = 0

  if (fresh.processing_status === 'ended') {
    const resultsStream = await client.messages.batches.results(batchId)

    for await (const item of resultsStream) {
      processedCount++
      const ticketId = item.custom_id
      const ticket = await loadTicketContext(ticketId)
      if (!ticket) {
        console.warn('[batch-poller] result for unknown ticket', ticketId)
        continue
      }

      if (item.result.type === 'succeeded') {
        try {
          const message = item.result.message
          // Convert Anthropic Message to agent_jobs result_columns shape.
          const content = stringifyMessageContent(message.content)
          const usage = {
            tokens_input: message.usage.input_tokens,
            tokens_output: message.usage.output_tokens,
            tokens_cache_read: (message.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
            tokens_cache_write: (message.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0,
          }
          const costUsd = await computeCostUsd(usage, message.model).catch(() => null)

          // Run the operation handler to parse content into result_columns.
          // Same helper the regular runner uses.
          const { runExpand } = await import('@/lib/agent/operations/expand')
          const { runSynthesise } = await import('@/lib/agent/operations/synthesise')
          const { runRefine } = await import('@/lib/agent/operations/refine')
          const { runGenerateContext } = await import('@/lib/agent/operations/generate-context')

          let resultColumns: Record<string, unknown>
          switch (ticket.operationType) {
            case 'expand': resultColumns = await runExpand(content); break
            case 'synthesise': resultColumns = await runSynthesise(content); break
            case 'refine': resultColumns = await runRefine(content, ticket.targetField); break
            case 'generate_context': resultColumns = await runGenerateContext(content); break
            default: throw new Error(`unsupported batched operation_type: ${ticket.operationType}`)
          }

          await persistFinalResult(supabase, ticketId, {
            resultColumns,
            usage,
            modelId: message.model,
            provider: 'anthropic',
            costUsd: costUsd ?? 0,
          })
          ticketsCompleted++
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'batch_result_processing_error'
          await persistFailure(supabase, ticketId, msg)
          ticketsFailed++
        }
      } else if (item.result.type === 'errored') {
        const errorType = (item.result.error as { type?: string }).type ?? 'batch_request_errored'
        const failureClass = classifyFailure({
          operationType: ticket.operationType,
          errorCode: errorType,
          httpStatus: 0,
        })
        await persistFailure(supabase, ticketId, errorType)
        await supabase
          .from('agent_jobs')
          .update({ failure_class: failureClass })
          .eq('id', ticketId)
        ticketsFailed++
      } else if (item.result.type === 'expired' || item.result.type === 'canceled') {
        await persistFailure(supabase, ticketId, `batch_request_${item.result.type}`)
        ticketsFailed++
      }
    }

    await supabase
      .from('anthropic_batches')
      .update({
        completed_at: new Date().toISOString(),
        completed_count: processedCount,
      })
      .eq('id', batchId)
  } else if (fresh.processing_status === 'canceling') {
    // Anthropic accepted cancel; tickets fail when they roll into 'ended'
    // status. Nothing to do this poll.
  }

  return { ended: fresh.processing_status === 'ended', ticketsCompleted, ticketsFailed }
}

async function readPollCount(batchId: string): Promise<number> {
  const supabase = createServiceRoleClient()
  const { data } = await supabase
    .from('anthropic_batches')
    .select('poll_count')
    .eq('id', batchId)
    .single()
  if (!data) return 0
  const raw = data.poll_count as number | null
  return raw ?? 0
}

interface TicketCtx {
  operationType: string
  targetField?: string
}

async function loadTicketContext(ticketId: string): Promise<TicketCtx | null> {
  const supabase = createServiceRoleClient()
  const { data: job } = await supabase
    .from('agent_jobs')
    .select('operation_type, profile_id, context_snapshot')
    .eq('id', ticketId)
    .single()
  if (!job) return null
  // For 'refine' the target_field is captured in context_snapshot
  const targetField =
    job.context_snapshot &&
    typeof job.context_snapshot === 'object' &&
    'dynamic' in job.context_snapshot
      ? ((job.context_snapshot as { dynamic?: { target_field?: string } }).dynamic
          ?.target_field as string | undefined)
      : undefined
  return { operationType: job.operation_type as string, targetField }
}

function mapAnthropicStatus(s: string): 'in_progress' | 'ended' | 'failed' | 'cancelled' {
  if (s === 'in_progress') return 'in_progress'
  if (s === 'ended') return 'ended'
  if (s === 'canceling') return 'cancelled'
  return 'failed'
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return JSON.stringify(content)
  // Concatenate text blocks.
  return content
    .map((block) => {
      const b = block as { type?: string; text?: string }
      if (b.type === 'text' && typeof b.text === 'string') return b.text
      return JSON.stringify(block)
    })
    .join('')
}
