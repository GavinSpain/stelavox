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

import { getProvider } from '@/lib/llm/factory'
import {
  buildConversationContext,
  finaliseAssistantMessage,
  findInterruptedTurn,
  markAssistantInterrupted,
} from '@/lib/director/conversation-context'
import { startDirectorTurn } from '@/lib/director/executor'
import { runIteration, type IterationEvent } from '@/lib/director/iteration-runner'
import { encodeHeartbeat, encodeSse, turnEventToSse } from '@/lib/director/sse'
import { SecurityViolationError } from '@/lib/security/canary'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { createClient } from '@/lib/supabase/server'
import type { DirectorConfig } from '@/lib/director/types'

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
  // Only modelId is used; provider is resolved per-iteration inside
  // the iteration runner. Call getProvider() to apply the V1.x-B.1.2
  // BYOK Edge Function routing as a side effect of factory resolution.
  const { modelId } = await getProvider(
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

  // V1.x-B.2.1 — DirectorSession is no longer constructed here. The
  // per-iteration runner builds its own session from organisationId +
  // documentId + conversationId passed via startDirectorTurn below.

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

      // V1.x-B.2.1 — resume now creates a NEW director_turns row using
      // startDirectorTurn, with the interrupted content pre-seeded into
      // the conversation context. The per-iteration runner then
      // continues from that pre-seeded view.
      //
      // Tradeoff: this drops the in-place edit semantic of the old V1.x-A.1
      // resume flow (where the SAME interrupted assistant_message row was
      // mutated to 'final'). The new flow creates a fresh director_turn +
      // accumulates into the same conversation_messages interim row,
      // preserving cost continuity at the conversation level. The
      // interrupted row stays interrupted at the row level (no
      // back-write); the user-facing message thread renders the most
      // recent assistant message which now carries the full resumed text.

      const totalUsage = { tokens_input: 0, tokens_output: 0, tokens_cache_read: 0, tokens_cache_write: 0 }
      let totalCost = 0
      let stopReasonFinal = 'unknown'
      let cleanExit = false
      let firstIterationJobId: string | null = null

      try {
        const start = await startDirectorTurn({
          supabase: service,
          conversationId,
          userMessageId: interrupted.id,
          assistantMessageId: interrupted.id,
          userMessageContent: priorUser.content,
          mentionedNodeIds: [],
          conversationContext: [
            ...conversationContext,
            {
              role: 'assistant',
              content:
                interrupted.content +
                '\n\n[The above response was interrupted. The author has asked you to resume from here. Continue your previous thought.]',
            },
          ],
          config: directorConfig,
          organisationId: conversation.organisation_id,
          documentId: conversation.document_id,
          // M-205: resume runs runIteration in this route handler's
          // own loop (same shape as /api/director/message). Mark
          // 'inline_route' so the dispatcher ignores these rows.
          consumerKind: 'inline_route',
        })
        firstIterationJobId = start.firstIterationJobId

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
          if (!outcome) break
          totalUsage.tokens_input += outcome.usage.tokens_input
          totalUsage.tokens_output += outcome.usage.tokens_output
          totalUsage.tokens_cache_read += outcome.usage.tokens_cache_read
          totalUsage.tokens_cache_write += outcome.usage.tokens_cache_write
          if (outcome.cost_usd !== null) totalCost += outcome.cost_usd
          stopReasonFinal = outcome.stop_reason

          if (outcome.cancelled) {
            writeEvent('error', { error: 'turn_cancelled', message: 'Director turn cancelled.' })
            cleanExit = true
            break
          }

          if (outcome.turn_complete || !outcome.next_iteration_job_id) {
            writeEvent('assistant_message_complete', {
              assistant_message_id: outcome.assistant_message_id,
              stop_reason: stopReasonFinal,
              tokens_input: totalUsage.tokens_input,
              tokens_output: totalUsage.tokens_output,
              tokens_cache_read: totalUsage.tokens_cache_read,
              tokens_cache_write: totalUsage.tokens_cache_write,
              cost_usd: totalCost,
            })
            const { data: finalMsg } = await service
              .from('conversation_messages')
              .select('content, tool_calls')
              .eq('id', interrupted.id)
              .single()
            await finaliseAssistantMessage(
              service,
              interrupted.id,
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
