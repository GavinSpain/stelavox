/**
 * Director — SSE wire-format helpers.
 *
 * Source: stelavox_phase5b_api_contract_v1_0.md §2.16 (v1.1).
 * Build Checklist: T-10 / T-20.1.
 *
 * Translates abstract TurnEvent objects (yielded by runAgenticTurn)
 * into the on-the-wire Server-Sent Events format. The client's
 * EventSource sees:
 *
 *   event: text_delta
 *   data: {"delta":"..."}
 *
 * Heartbeat lines are SSE comments — invisible to EventSource.onmessage
 * but flush through the connection to keep intermediaries alive.
 */

import 'server-only'

import type { IterationEvent } from '@/lib/director/iteration-runner'

/**
 * V1.x-B.2.1 — IterationEvent supersedes the legacy TurnEvent emitted by
 * the now-removed runAgenticTurn async generator. The shape of the
 * client-visible SSE wire is unchanged for the events the client
 * already handled (text_delta, tool_use_start, tool_use_complete,
 * workflow_proposal, error). `iteration_done` is server-side
 * bookkeeping — the route handler synthesises one
 * `assistant_message_complete` event after the LAST iteration
 * (turn_complete=true), not per-iteration.
 */
export type TurnEvent = IterationEvent

const ENC = new TextEncoder()

export function encodeSse(eventName: string, payload: unknown): Uint8Array {
  const body = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
  return ENC.encode(body)
}

export function encodeHeartbeat(): Uint8Array {
  return ENC.encode(`:heartbeat ${new Date().toISOString()}\n\n`)
}

/**
 * Map a TurnEvent emitted by the agentic loop to the on-the-wire SSE
 * event payload + name. Returns null for events that don't surface
 * to the client (e.g. iteration_boundary is server-side bookkeeping).
 */
export function turnEventToSse(
  event: TurnEvent,
): { name: string; payload: unknown } | null {
  switch (event.type) {
    case 'text_delta':
      return { name: 'text_delta', payload: { delta: event.delta } }
    case 'tool_use_start':
      return {
        name: 'tool_use_start',
        payload: { tool_call_id: event.tool_call_id, name: event.name },
      }
    case 'tool_use_complete':
      return {
        name: 'tool_use_complete',
        payload: {
          tool_call_id: event.tool_call_id,
          name: event.name,
          validation_result: event.validation_result,
          result_summary: event.result_summary,
        },
      }
    case 'workflow_proposal':
      return {
        name: 'workflow_proposal',
        payload: { proposal: event.proposal },
      }
    case 'error':
      return {
        name: 'error',
        payload: { error: event.error, message: event.message },
      }
    // The following events are server-side bookkeeping under the
    // V1.x-B.2.1 per-iteration model — not surfaced to the client wire.
    // assistant_message_complete is synthesised by the route handler
    // after the LAST iteration completes (it accumulates totals across
    // all iterations of a turn).
    case 'iteration_boundary':
    case 'iteration_done':
    case 'brief_proposal':
    case 'profile_amendment_proposal':
    case 'brief_cancellation_proposal':
    case 'brief_amendment_proposal':
      return null
    default:
      return null
  }
}
