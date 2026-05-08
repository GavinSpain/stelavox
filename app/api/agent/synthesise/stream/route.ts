/**
 * POST /api/agent/synthesise/stream — foreground streaming synthesise (SSE).
 *
 * Source: stelavox_phase5c_api_contract_v1_0.md §3.1.
 * Build Checklist: T-4.
 *
 * Validation arc mirrors the existing background synthesise route at
 * `app/api/agent/synthesise/route.ts` — auth, body, node visibility +
 * leaf + lock + version checks, profile resolution, agent_instruction
 * scan, concurrency check, token-budget gate. The fork starts after
 * INSERT: instead of `waitUntil(runAgentJob(jobId))` and a 202 response,
 * this route opens an SSE response and pipes `runAgentJobInline(jobId)`
 * events to the client.
 *
 * Workflow-dispatched synthesise stays in the background path — it never
 * reaches this route (Phase 5c API Contract §4.4).
 */

import 'server-only'

export const maxDuration = 300

import type { NextRequest } from 'next/server'

import { runAgentJobInline, type InlineRunnerEvent } from '@/lib/agent/runner'
import {
  checkConcurrency,
  validateAgentInstruction,
  validateProfile,
} from '@/lib/api/agent-operation-helper'
import { err, apiError } from '@/lib/api/errors'
import { getDocumentMaxLayerIndex, getNode, decorateWithLeaf } from '@/lib/data/nodes'
import { encodeHeartbeat, encodeSse } from '@/lib/director/sse'
import { checkTokenBudget } from '@/lib/llm/token-budget'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service'
import { synthesiseBodySchema } from '@/lib/validation/agent-operations'

export async function POST(request: NextRequest): Promise<Response> {
  // ---- 1. Auth ----------------------------------------------------------
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return err.unauthorised()

  // ---- 2. Body parse + Zod ---------------------------------------------
  const ct = request.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return err.invalidJson()

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return err.invalidJson()
  }
  if (!body) return err.missingBody()

  const parsed = synthesiseBodySchema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    if (issue?.code === 'unrecognized_keys') {
      const keys = (issue as { keys?: unknown[] }).keys
      return err.unknownField(String(keys?.[0] ?? ''))
    }
    return apiError(422, 'validation_failed', parsed.error.message)
  }
  const data = parsed.data

  // ---- 3. Target node visible (RLS) -----------------------------------
  const { data: node } = await getNode(supabase, data.node_id)
  if (!node) return err.notFound()

  // ---- 4. Synthesise: structural + leaf only (H-15) -------------------
  if (node.node_category !== 'structural') return err.invalidOperationForNodeType()
  const maxLayer = await getDocumentMaxLayerIndex(supabase, node.document_id ?? '')
  const decorated = decorateWithLeaf(node, maxLayer)
  if (!decorated.is_leaf) return err.notALeafNode()

  // ---- 5. Lock check ---------------------------------------------------
  if (node.locked) return apiError(423, 'node_locked', 'Target node is locked.')

  // ---- 6. Optional version-conflict check -----------------------------
  if (data.expected_version !== undefined && node.version !== data.expected_version) {
    return err.versionConflict(node, data.expected_version, node.version)
  }

  // ---- 7. Profile resolution ------------------------------------------
  const profileResult = await validateProfile(
    supabase,
    'synthesise',
    node.node_type,
    data.profile_id,
  )
  if (profileResult instanceof Response) return profileResult
  const profile = profileResult

  // ---- 8. Agent-instruction injection scan ----------------------------
  const scanResult = validateAgentInstruction(data.agent_instruction, node.id)
  if (scanResult) return scanResult

  // ---- 9. Concurrency: no other pending/running for this node ---------
  const concurrencyResult = await checkConcurrency(supabase, data.node_id)
  if (concurrencyResult) return concurrencyResult

  // ---- 10. Token-budget gate (H-07) -----------------------------------
  const svc = createServiceRoleClient()
  const { data: org } = await svc
    .from('organisations')
    .select('id, plan, current_period_start')
    .eq('id', node.organisation_id)
    .single()
  if (!org) return err.internal()
  const budgetOk = await checkTokenBudget(
    { id: org.id, plan: org.plan ?? 'trial', current_period_start: org.current_period_start },
    profile.max_tokens + 4096,
  )
  if (!budgetOk) return err.tokenBudgetExceeded()

  // ---- 11. INSERT agent_jobs (status='pending') -----------------------
  const now = new Date().toISOString()
  const { data: jobRow, error: insertErr } = await svc
    .from('agent_jobs')
    .insert({
      organisation_id: node.organisation_id,
      node_id: data.node_id,
      document_id: node.document_id,
      profile_id: profile.id,
      operation_type: 'synthesise',
      operation_class: 'single_node',
      status: 'pending',
      triggered_by: user.id,
      target_node_version_at_capture: node.version,
      context_snapshot: {
        dynamic: {
          agent_instruction: data.agent_instruction ?? '',
          prose_target_words: data.prose_target_words,
        },
      },
      created_at: now,
    })
    .select('id, organisation_id, node_id, profile_id')
    .single()

  if (insertErr || !jobRow) {
    console.error('[synthesise-stream] insert failed', { error: insertErr?.message })
    return err.internal()
  }

  // ---- 12. Open SSE response and pipe runner events ------------------
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let lastWriteAt = Date.now()
  let aborted = false
  let cleanExit = false

  // Wire the request's abort signal so we can short-circuit the runner
  // iteration when the client disconnects.
  request.signal.addEventListener('abort', () => {
    aborted = true
  })

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

      // SSE heartbeat (10s during silence) — defends against intermediate
      // proxies dropping idle connections. Server-side last_heartbeat_at
      // updates happen inside runAgentJobInline.
      heartbeatTimer = setInterval(() => {
        if (Date.now() - lastWriteAt >= 9_500 && !aborted) {
          writeRaw(encodeHeartbeat())
          // The SSE-spec heartbeat is a comment line, but we also surface
          // a typed event for clients that prefer EventSource.onmessage
          // over the raw stream. Match Phase 5c API Contract §2.2.
          writeEvent('heartbeat', { ts: new Date().toISOString() })
        }
      }, 5_000)

      try {
        const runnerGen = runAgentJobInline(jobRow.id)

        for await (const event of runnerGen as AsyncGenerator<InlineRunnerEvent>) {
          if (aborted) break

          switch (event.type) {
            case 'job_created':
              writeEvent('agent_job_created', {
                agent_job_id: event.payload.agent_job_id,
                operation_type: 'synthesise',
                target_node_id: event.payload.node_id,
                profile_id: event.payload.profile_id,
                started_at: new Date().toISOString(),
              })
              break
            case 'text_delta':
              writeEvent('text_delta', { delta: event.delta })
              break
            case 'usage':
              writeEvent('usage', {
                tokens_input: event.payload.tokens_input,
                tokens_output: event.payload.tokens_output,
                tokens_cache_read: event.payload.tokens_cache_read,
                tokens_cache_write: event.payload.tokens_cache_write,
                cost_usd: event.payload.cost_usd,
              })
              break
            case 'job_complete':
              writeEvent('agent_job_complete', {
                agent_job_id: event.payload.agent_job_id,
                status: 'completed',
                result_prose: event.payload.result_prose,
                completed_at: new Date().toISOString(),
              })
              break
            case 'error':
              writeEvent('error', {
                error: event.error,
                message: event.message,
              })
              break
          }
        }

        if (!aborted) {
          writeEvent('done', {})
          cleanExit = true
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : 'unknown_error'
        try {
          writeEvent('error', { error: 'internal_error', message })
        } catch {
          /* controller already closed */
        }
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try {
          controller.close()
        } catch {
          /* already closed */
        }
        // The `cleanExit` flag is informational only; runAgentJobInline's
        // own finally block handles the cancellation persistence when the
        // consumer breaks out of the iteration mid-stream. We do nothing
        // extra here.
        void cleanExit
      }
    },
    cancel() {
      // Browser closed / client aborted. Setting `aborted` lets the
      // for-await loop break at the next yield, which triggers
      // generator.return() on runnerGen, which fires its finally block
      // (persistCancellation).
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
