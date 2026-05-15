import 'server-only'

/**
 * V1.x-B.2.3 — Anthropic Batch API submitter for batched_24h tickets.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.2 +
 *         Director Architecture v2.0 §4.4 (batched_24h execution intent).
 *
 * Tickets with execution_intent='batched_24h' bypass the regular
 * dispatcher path. Instead they accumulate in a buffer (queue_status
 * remains 'queued' until submission). When the buffer for a given
 * pool_key reaches min_batch_size OR the oldest ticket exceeds
 * max_wait_minutes, the submitter:
 *   1. Loads each ticket's job + profile + pre-assembled context.
 *   2. Builds the Anthropic Batch API request body — one BatchRequest
 *      per ticket with custom_id = agent_jobs.id.
 *   3. POSTs to messages.batches.create.
 *   4. INSERTs the anthropic_batches row.
 *   5. UPDATEs each ticket: batch_anthropic_id + batch_submitted_at +
 *      queue_status='dispatched'.
 *   6. The batch-poller (lib/scheduler/batch-poller.ts) handles
 *      result write-back.
 *
 * Pool isolation: tickets are grouped by pool_key (BYOK can't share
 * batches with platform). Each pool gets its own batch.
 *
 * Out of B.2.3 scope:
 *   - Per-ticket cost reconciliation against the bucket. The Anthropic
 *     Batch API discounts the per-token rate by 50%; B.2.3 records
 *     total tokens but doesn't yet compute discounted cost (deferred
 *     to V1.x-C pricing_rates table integration).
 *   - Workflow_step batched_24h tickets — the build-checklist eligible
 *     ops are expand/synthesise/refine/generate_context which run
 *     through agent_jobs.profile_id; the submitter assembles per-ticket
 *     prompts via assembleAndPersistContext just like runAgentJob.
 *     Director iterations are NEVER batched.
 */

import Anthropic from '@anthropic-ai/sdk'

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'
import { loadJobAndProfile, persistRunningStart, assembleAndPersistContext } from '@/lib/agent/job-lifecycle'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SubmitResult {
  /** Batches submitted in this invocation (across all pool_keys). */
  batchesSubmitted: number
  /** Total tickets submitted across all batches. */
  ticketsSubmitted: number
  /** Skipped because their pool's buffer hadn't met the threshold. */
  ticketsBuffered: number
}

interface PendingTicket {
  id: string
  organisation_id: string
  document_id: string | null
  operation_type: string
  route: string
  user_id: string | null
  profile_id: string | null
  queued_at: string
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Inspect the batched_24h buffer; submit batches that meet the
 * min_batch_size or max_wait_minutes threshold per pool.
 *
 * Idempotent: tickets only become eligible for submission if their
 * batch_anthropic_id is NULL. Once submitted, queue_status moves to
 * 'dispatched' and they leave the buffer-eligibility view.
 */
export async function submitReadyBatches(): Promise<SubmitResult> {
  const supabase = createServiceRoleClient()
  const minBatchSize = (await getConfig<number>('agent.batched_24h_min_batch_size')) ?? 5
  const maxWaitMinutes = (await getConfig<number>('agent.batched_24h_max_wait_minutes')) ?? 30
  const eligibleOps = (await getConfig<string[]>('agent.batched_24h_eligible_operations')) ?? [
    'expand', 'synthesise', 'refine', 'generate_context',
  ]

  // 1. Find pending batched_24h tickets.
  const { data: pending, error } = await supabase
    .from('agent_jobs')
    .select('id, organisation_id, document_id, operation_type, route, profile_id, queued_at')
    .eq('execution_intent', 'batched_24h')
    .eq('queue_status', 'queued')
    .is('batch_anthropic_id', null)
    .in('operation_type', eligibleOps)
    .order('queued_at', { ascending: true })

  if (error || !pending || pending.length === 0) {
    return { batchesSubmitted: 0, ticketsSubmitted: 0, ticketsBuffered: 0 }
  }

  // 2. Group by pool_key (BYOK can't mix with platform; each pool key gets its own batch).
  const groups = new Map<string, PendingTicket[]>()
  for (const t of pending as PendingTicket[]) {
    const poolKey = t.route === 'byok' && t.user_id ? `byok:${t.user_id}` : 'platform'
    const arr = groups.get(poolKey) ?? []
    arr.push(t)
    groups.set(poolKey, arr)
  }

  let batchesSubmitted = 0
  let ticketsSubmitted = 0
  let ticketsBuffered = 0

  const now = Date.now()
  const maxWaitMs = maxWaitMinutes * 60 * 1000

  for (const [poolKey, tickets] of groups) {
    const oldestAgeMs = now - new Date(tickets[0].queued_at).getTime()
    const meetsSize = tickets.length >= minBatchSize
    const meetsAge = oldestAgeMs >= maxWaitMs

    if (!meetsSize && !meetsAge) {
      ticketsBuffered += tickets.length
      continue
    }

    // 3. Submit this group.
    try {
      const result = await submitBatchForPool(poolKey, tickets)
      batchesSubmitted += result.submitted ? 1 : 0
      ticketsSubmitted += result.tickets
    } catch (err) {
      console.error('[batch-submitter] submit failed for pool', poolKey, err instanceof Error ? err.message : String(err))
      // Tickets stay in queue; will retry next invocation.
    }
  }

  return { batchesSubmitted, ticketsSubmitted, ticketsBuffered }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function submitBatchForPool(
  poolKey: string,
  tickets: PendingTicket[],
): Promise<{ submitted: boolean; tickets: number }> {
  const supabase = createServiceRoleClient()

  // Build per-ticket Anthropic batch request bodies. Reuses the
  // existing job-lifecycle helpers so prompt assembly is identical
  // to the regular runner path.
  const batchRequests: Array<{
    custom_id: string
    params: Record<string, unknown>
  }> = []

  const ticketIds: string[] = []

  for (const ticket of tickets) {
    const loaded = await loadJobAndProfile(supabase, ticket.id)
    if (loaded.kind !== 'ok') {
      console.warn('[batch-submitter] skipping ticket — load failed', ticket.id, loaded.kind)
      continue
    }
    const { job, profile, dynamicCtx } = loaded
    const assembled = await assembleAndPersistContext(supabase, job, profile, dynamicCtx)

    // Convert AssembledPrompt to Anthropic Messages API params.
    // For batched_24h we do not stream; the Batch API returns full
    // results once processing ends.
    const params: Record<string, unknown> = {
      model: assembled.config.model,
      max_tokens: assembled.config.maxTokens,
      messages: assembled.dynamic.messages ?? [{
        role: 'user',
        content: assembled.dynamic.securityWrapped,
      }],
      system: assembled.stable.securityWrapped,
    }
    if (typeof assembled.config.temperature === 'number') {
      params.temperature = assembled.config.temperature
    }

    batchRequests.push({ custom_id: ticket.id, params })
    ticketIds.push(ticket.id)
  }

  if (batchRequests.length === 0) {
    return { submitted: false, tickets: 0 }
  }

  // Resolve API key: platform pool uses ANTHROPIC_API_KEY; BYOK pool
  // pulls from user_anthropic_keys via the Edge Function. For B.2.3
  // substrate we route only platform pool through the SDK directly;
  // BYOK batched_24h is deferred to V1.x-C alongside the per-org
  // BYOK rewire. Skip BYOK pools for now.
  if (poolKey !== 'platform') {
    console.warn('[batch-submitter] BYOK pool batched submission deferred to V1.x-C', poolKey)
    return { submitted: false, tickets: 0 }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set; cannot submit batch')
  }

  const client = new Anthropic({ apiKey })

  // 4. POST the batch.
  const batch = await client.messages.batches.create({
    requests: batchRequests as unknown as Parameters<typeof client.messages.batches.create>[0]['requests'],
  })

  // 5. INSERT anthropic_batches row.
  await supabase.from('anthropic_batches').insert({
    id: batch.id,
    request_count: batchRequests.length,
    pool_key: poolKey,
    status: 'in_progress',
  })

  // 6. UPDATE each ticket: batch_anthropic_id + batch_submitted_at +
  //    queue_status='dispatched' (so the dispatcher's queued query
  //    skips them).
  const submittedAt = new Date().toISOString()
  await supabase
    .from('agent_jobs')
    .update({
      batch_anthropic_id: batch.id,
      batch_submitted_at: submittedAt,
      queue_status: 'dispatched',
      status: 'running',
      dispatched_at: submittedAt,
    })
    .in('id', ticketIds)

  // 7. Mark tickets as 'running' via the standard claim helper for any
  //    extra side-effects (started_at + last_heartbeat_at). Batched
  //    tickets don't use heartbeats but the row state should be
  //    consistent with the regular runner path.
  for (const ticketId of ticketIds) {
    try {
      await persistRunningStart(supabase, ticketId)
    } catch {
      // Idempotent — already-running rows are fine.
    }
  }

  return { submitted: true, tickets: ticketIds.length }
}
