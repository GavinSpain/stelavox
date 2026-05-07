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
import { computeCostUsd } from '@/lib/llm/cost'
import { runAgenticTurn, type TurnEvent } from '@/lib/director/executor'
import { persistDraftWorkflow } from '@/lib/director/workflow-executor'
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
import type { DirectorConfig, DirectorSession } from '@/lib/director/types'

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

  const { provider, modelId } = await getProvider(
    { id: organisationId },
    'director',
    directorConfig.model_id,
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

  // ---- 11. Build session + conversation context ------------------------
  const session: DirectorSession = {
    conversation_id: conversation.id,
    document_id,
    organisation_id: organisationId,
    user_id: user.id,
  }
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

      // Initial 'start' event with conversation_id + assistant message id.
      writeEvent('start', {
        conversation_id: conversation.id,
        user_message_id: undefined,
        assistant_message_id: assistantRow.id,
      })

      // Heartbeat every 10s during silence (I-10).
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastWriteAt >= 9_500 && !aborted) {
          writeRaw(encodeHeartbeat())
        }
      }, 5_000)

      const accumulator: { content: string; toolCalls: unknown[]; usage: { tokens_input: number; tokens_output: number; tokens_cache_read: number; tokens_cache_write: number }; cost: number | null } = {
        content: '',
        toolCalls: [],
        usage: { tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0 },
        cost: null,
      }
      let cleanExit = false

      try {
        const turnGen = runAgenticTurn({
          session,
          config: directorConfig,
          provider,
          conversationContext,
          userMessageContent: content,
          mentionedNodeIds: mentioned_node_ids,
          assistantMessageId: assistantRow.id,
          supabase: service,
        })

        for await (const event of turnGen as AsyncGenerator<TurnEvent>) {
          if (aborted) break

          // Track accumulator for finalisation.
          if (event.type === 'text_delta') {
            accumulator.content += event.delta
          } else if (event.type === 'tool_use_complete') {
            accumulator.toolCalls.push({
              id: event.tool_call_id,
              name: event.name,
              validation_result: event.validation_result,
              result_summary: event.result_summary,
              executed_at: new Date().toISOString(),
            })
          } else if (event.type === 'turn_complete') {
            accumulator.usage = event.usage
            accumulator.cost = await computeCostUsd(event.usage, modelId).catch(() => null)
          } else if (event.type === 'workflow_proposal') {
            // Persist the draft workflow now so the assistant message
            // it accompanies has a corresponding workflow_id to link to.
            try {
              const workflowId = await persistDraftWorkflow({
                supabase: service,
                organisationId,
                documentId: document_id,
                conversationId: conversation.id,
                proposal: event.proposal,
              })
              // Link the workflow id back onto the assistant message row
              // so the UI can render the PlanCard inline (Phase 5b §2.13).
              await service
                .from('conversation_messages')
                .update({ workflow_id: workflowId })
                .eq('id', assistantRow.id)
            } catch (err) {
              console.error('[director-message] persistDraftWorkflow failed', {
                conversation: conversation.id,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          const sse = turnEventToSse(event)
          if (sse) writeEvent(sse.name, sse.payload)
        }

        if (!aborted) {
          // Finalise the assistant message row (Phase 5b I-12).
          await finaliseAssistantMessage(
            service,
            assistantRow.id,
            accumulator.content,
            accumulator.toolCalls,
            accumulator.usage,
            accumulator.cost,
          )
          writeEvent('done', {})
          cleanExit = true
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
