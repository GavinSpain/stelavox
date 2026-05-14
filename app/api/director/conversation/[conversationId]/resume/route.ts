/**
 * POST /api/director/conversation/[conversationId]/resume — Resume an
 * interrupted Director turn.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §3.12 / I-12 (v1.1).
 * Build Checklist: T-20.1.
 *
 * Loads the at-most-one turn_state='interrupted' assistant message
 * row, re-feeds the partial content + already-completed tool calls
 * back into the agentic loop, continues from there. UPDATE the same
 * row on clean end-of-turn ('interrupted' → 'final') — preserves
 * cost of every tool call already paid for.
 *
 * Wire format: identical to /api/director/message except the 'start'
 * event payload includes { resumed: true, recovered_tool_call_count }.
 */

import 'server-only'

export const maxDuration = 300

import { NextResponse, type NextRequest } from 'next/server'

import { computeCostUsd } from '@/lib/llm/cost'
import { getProvider } from '@/lib/llm/factory'
import {
  buildConversationContext,
  finaliseAssistantMessage,
  findInterruptedTurn,
  markAssistantInterrupted,
} from '@/lib/director/conversation-context'
import { runAgenticTurn, type TurnEvent } from '@/lib/director/executor'
import { encodeHeartbeat, encodeSse, turnEventToSse } from '@/lib/director/sse'
import { persistDraftWorkflow } from '@/lib/director/workflow-executor'
import { SecurityViolationError } from '@/lib/security/canary'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import type { DirectorConfig, DirectorSession } from '@/lib/director/types'

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  void req
  const { conversationId } = await context.params

  // ---- Auth ------------------------------------------------------------
  const userClient = await createClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const service = createServiceRoleClient()

  // ---- Conversation visibility (RLS via user-session client) ----------
  const { data: conversation } = await userClient
    .from('conversations')
    .select('id, document_id, organisation_id')
    .eq('id', conversationId)
    .maybeSingle()
  if (!conversation) {
    return NextResponse.json(
      { error: 'conversation_not_found' },
      { status: 404 },
    )
  }

  // ---- Locate the interrupted turn ------------------------------------
  // findInterruptedTurn returns the most recent if 2+ are present;
  // we re-query for an exact 2-row count to detect data integrity issues.
  const { data: allInterrupted, error: cntErr } = await service
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('turn_state', 'interrupted')

  if (cntErr) {
    return NextResponse.json(
      { error: 'query_failed', message: cntErr.message },
      { status: 500 },
    )
  }
  if (!allInterrupted || allInterrupted.length === 0) {
    return NextResponse.json(
      { error: 'no_interrupted_turn' },
      { status: 409 },
    )
  }
  if (allInterrupted.length > 1) {
    console.error('[director-resume] multiple_interrupted_turns', {
      conversation: conversationId,
      count: allInterrupted.length,
    })
    return NextResponse.json(
      {
        error: 'multiple_interrupted_turns',
        message:
          'More than one interrupted assistant turn exists for this conversation. Manual recovery required.',
      },
      { status: 500 },
    )
  }

  const interrupted = await findInterruptedTurn(service, conversationId)
  if (!interrupted) {
    return NextResponse.json(
      { error: 'no_interrupted_turn' },
      { status: 409 },
    )
  }

  // Find the originating user message (the one immediately before the
  // interrupted assistant row, by sequence).
  const { data: priorUser } = await service
    .from('conversation_messages')
    .select('id, content, sequence')
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .lt('sequence', interrupted.sequence)
    .order('sequence', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!priorUser) {
    return NextResponse.json(
      {
        error: 'cannot_resume_no_prior_user_message',
        message: 'No prior user message found for the interrupted turn.',
      },
      { status: 500 },
    )
  }

  // ---- Director config + provider --------------------------------------
  const { data: configRow } = await service
    .from('director_configs')
    .select('id, version_number, status, system_prompt, tool_suite, model_id, model_params, capability_flags')
    .eq('status', 'production')
    .maybeSingle()
  if (!configRow) {
    return NextResponse.json(
      { error: 'no_production_director_config' },
      { status: 500 },
    )
  }
  const directorConfig = configRow as unknown as DirectorConfig
  // V1.x-B.1.2 — pass user.id so the factory routes via the BYOK Edge
  // Function when the user has a per-user Anthropic key on file.
  const { provider, modelId } = await getProvider(
    { id: conversation.organisation_id },
    'director',
    directorConfig.model_id,
    user.id,
  )
  directorConfig.model_id = modelId

  // ---- Mark the interrupted row interim again (so the agentic loop's
  // mid-turn persistence updates target the right row) -----------------
  await service
    .from('conversation_messages')
    .update({ turn_state: 'interim' })
    .eq('id', interrupted.id)

  // ---- Build session + context ----------------------------------------
  const session: DirectorSession = {
    conversation_id: conversationId,
    document_id: conversation.document_id,
    organisation_id: conversation.organisation_id,
    user_id: user.id,
  }

  // Conversation context up to but NOT including the interrupted row
  // (we'll feed the interrupted row's partial content as part of the
  // dynamic body via the executor's continuation hint).
  const conversationContext = await buildConversationContext(service, conversationId)

  const recoveredToolCalls = Array.isArray(interrupted.tool_calls)
    ? interrupted.tool_calls.length
    : 0

  // ---- Open SSE response ----------------------------------------------
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let lastWriteAt = Date.now()
  let aborted = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const writeRaw = (b: Uint8Array) => {
        try {
          controller.enqueue(b)
          lastWriteAt = Date.now()
        } catch {
          aborted = true
        }
      }
      const writeEvent = (name: string, payload: unknown) => {
        writeRaw(encodeSse(name, payload))
      }

      writeEvent('start', {
        conversation_id: conversationId,
        assistant_message_id: interrupted.id,
        resumed: true,
        recovered_tool_call_count: recoveredToolCalls,
      })

      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastWriteAt >= 9_500 && !aborted) {
          writeRaw(encodeHeartbeat())
        }
      }, 5_000)

      const accumulator = {
        content: interrupted.content as string,
        toolCalls: Array.isArray(interrupted.tool_calls)
          ? [...(interrupted.tool_calls as unknown[])]
          : [],
        usage: {
          tokens_input: 0,
          tokens_output: 0,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
        },
        cost: null as number | null,
      }
      let cleanExit = false

      try {
        // Re-feed the partial assistant content. The executor's
        // buildToolUseContinuation handles the V1 simplified format.
        // The user message we pass is the original prior_user content;
        // the agentic loop will continue producing text + tools.
        const turnGen = runAgenticTurn({
          session,
          config: directorConfig,
          provider,
          conversationContext: [
            ...conversationContext,
            // Pre-seed the model's view: we treat the interrupted row's
            // accumulated content as a prior assistant turn that ended
            // mid-thought.
            {
              role: 'assistant',
              content:
                interrupted.content +
                '\n\n[The above response was interrupted. The author has asked you to resume from here. Continue your previous thought.]',
            },
          ],
          userMessageContent: priorUser.content,
          mentionedNodeIds: [],
          assistantMessageId: interrupted.id,
          supabase: service,
        })

        for await (const event of turnGen as AsyncGenerator<TurnEvent>) {
          if (aborted) break

          if (event.type === 'text_delta') {
            accumulator.content += event.delta
          } else if (event.type === 'tool_use_complete') {
            accumulator.toolCalls.push({
              id: event.tool_call_id,
              name: event.name,
              validation_result: event.validation_result,
              result_summary: event.result_summary,
              executed_at: new Date().toISOString(),
              // V1.x-A.1 (v1.6): forward proposal_artefact for UI re-render.
              ...(event.proposal_artefact !== undefined
                ? { proposal_artefact: event.proposal_artefact }
                : {}),
            })
          } else if (event.type === 'turn_complete') {
            accumulator.usage = event.usage
            accumulator.cost = await computeCostUsd(event.usage, modelId).catch(() => null)
          } else if (event.type === 'workflow_proposal') {
            try {
              const workflowId = await persistDraftWorkflow({
                supabase: service,
                organisationId: conversation.organisation_id,
                documentId: conversation.document_id,
                conversationId,
                proposal: event.proposal,
              })
              await service
                .from('conversation_messages')
                .update({ workflow_id: workflowId })
                .eq('id', interrupted.id)
            } catch (err) {
              console.error('[director-resume] persistDraftWorkflow failed', {
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }

          const sse = turnEventToSse(event)
          if (sse) writeEvent(sse.name, sse.payload)
        }

        if (!aborted) {
          await finaliseAssistantMessage(
            service,
            interrupted.id,
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
          // Resume itself was interrupted — re-mark the row interrupted
          // so it can be resumed again.
          await markAssistantInterrupted(service, interrupted.id)
        }
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
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
