/**
 * POST /api/director/message — streaming Director conversation endpoint.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.1, §1.5 (v1.1).
 * Build Checklist: T-10 / T-12.1.
 *
 * Vercel Node.js API route with maxDuration=300. Returns Response with
 * a ReadableStream body for SSE. The agentic loop (lib/director/executor)
 * runs inline in the request handler — no Edge Function.
 *
 * Validation order (API Contract §3.1 v1.1):
 *   1. Auth (401)
 *   2. Document scope (403/404)
 *   3. Conversation resolution (or creation)
 *   4. Content validation (400)
 *   5. Director-message rate limit (429)
 *   6. Token budget gate (402)
 *   7. Conversation summarisation if total tokens > threshold (I-9)
 *   8. Append user message
 *   9. Create interim assistant message
 *  10. Open SSE response; run agentic loop; finalise on clean exit
 */

import 'server-only'

export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'

import { getConfigInt } from '@/lib/config/platform-config'
import { getProvider } from '@/lib/llm/factory'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { startDirectorTurn } from '@/lib/director/executor'
import { runIteration, type IterationEvent } from '@/lib/director/iteration-runner'
import {
  appendUserMessage,
  buildConversationContext,
  createInterimAssistantMessage,
  finaliseAssistantMessage,
  getOrCreateConversation,
  markAssistantInterrupted,
  shouldSummarise,
  summariseConversation,
} from '@/lib/director/conversation-context'
import { encodeHeartbeat, encodeSse, turnEventToSse } from '@/lib/director/sse'
import { MessageRequestSchema } from '@/lib/director/schemas'
import { SecurityViolationError } from '@/lib/security/canary'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import type { DirectorConfig } from '@/lib/director/types'

export async function POST(req: NextRequest): Promise<Response> {
  // ---- 1. Auth ---------------------------------------------------------
  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'Sign in required.' },
      { status: 401 },
    )
  }

  // ---- 2. Body parse + validate ----------------------------------------
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_json', message: 'Body must be valid JSON.' },
      { status: 400 },
    )
  }
  const parsed = MessageRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'validation_failed', message: parsed.error.message },
      { status: 400 },
    )
  }
  const { document_id, conversation_id, content, mentioned_node_ids } =
    parsed.data

  // ---- 3. Resolve organisation + document via the user-bound client ----
  // RLS on documents table enforces org membership; if the row is
  // visible, the caller is admitted. Cross-org returns 404.
  const { data: doc, error: docErr } = await userClient
    .from('documents')
    .select('id, organisation_id')
    .eq('id', document_id)
    .maybeSingle()
  if (docErr || !doc) {
    return NextResponse.json(
      { error: 'document_not_found', message: 'Document not found.' },
      { status: 404 },
    )
  }
  const organisationId = doc.organisation_id

  // ---- 4. Service-role client for the rest of the path -----------------
  // Trust boundary established: caller is authed and has access to doc.
  const service = createServiceRoleClient()

  // ---- 5. Conversation resolution (G-2 / I-12) -------------------------
  let conversation
  if (conversation_id) {
    const { data } = await service
      .from('conversations')
      .select('id, document_id, organisation_id, conversation_summary, summary_covers_through')
      .eq('id', conversation_id)
      .maybeSingle()
    if (!data || data.document_id !== document_id) {
      return NextResponse.json(
        { error: 'conversation_not_found', message: 'Conversation not found.' },
        { status: 404 },
      )
    }
    conversation = data
  } else {
    conversation = await getOrCreateConversation(service, organisationId, document_id)
  }

  // ---- 6. Director-message rate limit ----------------------------------
  const rateLimit = await getConfigInt(
    'agent.director_message_rate_limit_per_60s',
  )
  const cutoff = new Date(Date.now() - 60_000).toISOString()
  const { count: recentCount } = await service
    .from('conversation_messages')
    .select('*', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('role', 'user')
    .gte('created_at', cutoff)
  if ((recentCount ?? 0) >= rateLimit) {
    return NextResponse.json(
      {
        error: 'director_message_rate_limit',
        message: `Rate limit exceeded (${rateLimit} per 60s).`,
        retry_after_seconds: 60,
      },
      { status: 429 },
    )
  }

  // ---- 6.5. Token budget gate (round-3 audit B5.5, F-187) -------------
  // H-07's stated scope explicitly names "director message" but pre-fix
  // this route never called checkTokenBudget. A user with depleted
  // budget could still drive the Director and rack up cost. Estimate
  // is intentionally generous (worst-case Director turn = many tool
  // calls + conversation history + response) so the gate is a soft
  // guard that catches obvious budget exhaustion rather than a precise
  // accounting (the actual tokens are recorded post-turn via the
  // existing usage_records pipeline).
  const { data: org } = await service
    .from('organisations')
    .select('id, plan, current_period_start')
    .eq('id', organisationId)
    .maybeSingle()
  if (!org) {
    return NextResponse.json(
      { error: 'organisation_not_found', message: 'Org row missing.' },
      { status: 500 },
    )
  }
  // V1.x-C.2 — the gate now needs the Director's model_id to convert
  // the estimated_tokens_per_turn into a credit estimate. Hoist a small
  // model_id read (the full director_config load happens later at §8;
  // this is a cheap pre-read and avoids restructuring the route).
  const { data: directorModelRow } = await service
    .from('director_configs')
    .select('model_id')
    .eq('status', 'production')
    .maybeSingle()
  const directorModelId = directorModelRow?.model_id ?? null
  if (!directorModelId) {
    return NextResponse.json(
      { error: 'no_production_director_config', message: 'No production Director config found.' },
      { status: 500 },
    )
  }
  const directorTurnEstimate = await getConfigInt(
    'agent.director_estimated_tokens_per_turn',
  )
  const budgetOk = await checkTokenBudget(
    { id: org.id, plan: org.plan ?? 'trial', current_period_start: org.current_period_start },
    directorTurnEstimate,
    directorModelId,
  )
  if (!budgetOk) {
    return NextResponse.json(
      {
        error: 'token_budget_exceeded',
        message: 'Token budget exhausted for the current period.',
      },
      { status: 402 },
    )
  }

  // ---- 7. Single-flight check (I-12) -----------------------------------
  // No more than one interim assistant row per conversation.
  const { data: interim } = await service
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('turn_state', 'interim')
    .maybeSingle()
  if (interim) {
    return NextResponse.json(
      {
        error: 'conversation_locked',
        message:
          'Another Director turn is in progress for this conversation. Wait for it to finish or use the resume endpoint.',
      },
      { status: 409 },
    )
  }

  // ---- 8. Director config load + provider ------------------------------
  const { data: configRow } = await service
    .from('director_configs')
    .select('id, version_number, status, system_prompt, tool_suite, model_id, model_params, capability_flags')
    .eq('status', 'production')
    .maybeSingle()
  if (!configRow) {
    return NextResponse.json(
      { error: 'no_production_director_config', message: 'No production Director config found.' },
      { status: 500 },
    )
  }
  const directorConfig = configRow as unknown as DirectorConfig

  // V1.x-B.1.2 — pass user.id so the factory routes via the BYOK Edge
  // Function when the user has a per-user Anthropic key on file.
  const { provider, modelId } = await getProvider(
    { id: organisationId },
    'director',
    directorConfig.model_id,
    user.id,
  )
  // Resolved model_id may differ from the seed (e.g. local override). Use the resolved one.
  directorConfig.model_id = modelId

  // ---- 9. Optional summarisation pass (I-9) ----------------------------
  if (await shouldSummarise(service, conversation.id)) {
    try {
      await summariseConversation(service, conversation.id, provider, modelId)
    } catch (err) {
      console.error('[director-message] summarisation failed', {
        conversation: conversation.id,
        error: err instanceof Error ? err.message : String(err),
      })
      // Continue — failed summarisation is not fatal; the turn still runs.
    }
  }

  // ---- 10. Append user message + create interim assistant message -----
  await appendUserMessage(
    service,
    conversation.id,
    user.id,
    content,
    mentioned_node_ids,
  )
  const assistantRow = await createInterimAssistantMessage(service, conversation.id)

  // ---- 11. Build conversation context ------------------------
  // V1.x-B.2.1 — DirectorSession is no longer constructed here. The
  // per-iteration runner builds its own from organisationId +
  // documentId + conversationId passed via startDirectorTurn below.
  const conversationContext = await buildConversationContext(
    service,
    conversation.id,
  )

  // ---- 12. Open SSE response -------------------------------------------
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let lastWriteAt = Date.now()
  let aborted = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeRaw = (bytes: Uint8Array) => {
        try {
          controller.enqueue(bytes)
          lastWriteAt = Date.now()
        } catch {
          aborted = true
        }
      }
      const writeEvent = (name: string, payload: unknown) => {
        writeRaw(encodeSse(name, payload))
      }

      // ----------------------------------------------------------------
      // V1.x-B.2.1 — per-iteration Director model.
      //
      // 1. startDirectorTurn creates the director_turns row + first
      //    agent_jobs row of operation_type='director_iteration'.
      // 2. The route handler loops: runIteration(currentJobId) is an
      //    async generator yielding IterationEvent items; the route maps
      //    them to SSE wire events. iteration_done carries the
      //    next_iteration_job_id (or null if turn complete).
      // 3. On final iteration, the route synthesises an
      //    assistant_message_complete event with accumulated usage and
      //    finalises the conversation_messages row.
      //
      // Wire format unchanged for the events the client already handles
      // (text_delta, tool_use_start, tool_use_complete, workflow_proposal,
      // error, assistant_message_complete, done). turn_id is added to
      // the start event so the client can mount the StopButton.
      // ----------------------------------------------------------------

      let turnId: string | null = null
      let firstIterationJobId: string | null = null
      try {
        const start = await startDirectorTurn({
          supabase: service,
          conversationId: conversation.id,
          userMessageId: assistantRow.id, // assistant interim row; user_message_id reused for the link
          assistantMessageId: assistantRow.id,
          userMessageContent: content,
          mentionedNodeIds: mentioned_node_ids,
          conversationContext,
          config: directorConfig,
          organisationId,
          documentId: document_id,
        })
        turnId = start.turnId
        firstIterationJobId = start.firstIterationJobId
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'startDirectorTurn failed'
        writeEvent('start', {
          conversation_id: conversation.id,
          user_message_id: undefined,
          assistant_message_id: assistantRow.id,
        })
        writeEvent('error', { error: 'start_turn_failed', message: msg })
        await markAssistantInterrupted(service, assistantRow.id)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        return
      }

      // Initial 'start' event — now carries turn_id so the client can
      // wire the StopButton to /api/director/turns/[turnId]/stop.
      writeEvent('start', {
        conversation_id: conversation.id,
        user_message_id: undefined,
        assistant_message_id: assistantRow.id,
        turn_id: turnId,
      })

      // Heartbeat every 10s during silence (I-10).
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastWriteAt >= 9_500 && !aborted) {
          writeRaw(encodeHeartbeat())
        }
      }, 5_000)

      // Accumulators for the synthesised assistant_message_complete +
      // finaliseAssistantMessage call after the LAST iteration.
      const totalUsage = { tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0 }
      let totalCost = 0
      let stopReasonFinal = 'unknown'
      let cleanExit = false

      try {
        let currentJobId: string | null = firstIterationJobId
        while (currentJobId && !aborted) {
          const gen = runIteration(currentJobId)
          let outcome: Extract<IterationEvent, { type: 'iteration_done' }> | null = null

          for await (const event of gen) {
            if (aborted) break

            if (event.type === 'iteration_done') {
              outcome = event
              continue
            }

            const sse = turnEventToSse(event)
            if (sse) writeEvent(sse.name, sse.payload)
          }

          if (!outcome) {
            // The runner exited without yielding iteration_done. This
            // happens when an early-return path (e.g. provider error,
            // missing config, turn already cancelled) yielded an error
            // event but no terminal event. Surface to the client.
            writeEvent('error', { error: 'iteration_runner_exited', message: 'Director iteration ended without a terminal event.' })
            break
          }

          totalUsage.tokens_input += outcome.usage.tokens_input
          totalUsage.tokens_output += outcome.usage.tokens_output
          totalUsage.tokens_cache_read += outcome.usage.tokens_cache_read
          totalUsage.tokens_cache_write += outcome.usage.tokens_cache_write
          if (outcome.cost_usd !== null) totalCost += outcome.cost_usd
          stopReasonFinal = outcome.stop_reason

          if (outcome.cancelled) {
            // Stop fired mid-turn — director_turns + the iteration row
            // were already updated by the runner. Surface and exit.
            writeEvent('error', { error: 'turn_cancelled', message: 'Director turn cancelled.' })
            cleanExit = true
            break
          }

          if (outcome.turn_complete || !outcome.next_iteration_job_id) {
            // Final iteration. Synthesise assistant_message_complete +
            // finalise the conversation_messages row.
            writeEvent('assistant_message_complete', {
              assistant_message_id: outcome.assistant_message_id,
              stop_reason: stopReasonFinal,
              tokens_input: totalUsage.tokens_input,
              tokens_output: totalUsage.tokens_output,
              tokens_cache_read: totalUsage.tokens_cache_read,
              tokens_cache_write: totalUsage.tokens_cache_write,
              cost_usd: totalCost,
            })

            // Re-read the running accumulator (iteration-runner UPDATEd
            // content + tool_calls per iteration) and finalise the row.
            const { data: finalMsg } = await service
              .from('conversation_messages')
              .select('content, tool_calls')
              .eq('id', assistantRow.id)
              .single()
            await finaliseAssistantMessage(
              service,
              assistantRow.id,
              (finalMsg?.content as string) ?? '',
              (finalMsg?.tool_calls as unknown[]) ?? [],
              totalUsage,
              totalCost,
            )
            writeEvent('done', {})
            cleanExit = true
            break
          }

          currentJobId = outcome.next_iteration_job_id
        }
      } catch (err) {
        if (err instanceof SecurityViolationError) {
          writeEvent('error', {
            error: 'director_canary_leak',
            message: 'System integrity check failed.',
          })
        } else {
          const msg = err instanceof Error ? err.message : 'unknown_error'
          writeEvent('error', { error: 'provider_error', message: msg })
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        if (!cleanExit) {
          // Disconnect or error: mark interrupted (Phase 5b I-12).
          await markAssistantInterrupted(service, assistantRow.id)
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      // Browser closed / client aborted. The async iterator may still
      // be running — set aborted so the loop exits at its next event,
      // and let the finally block mark the interim row interrupted.
      aborted = true
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
