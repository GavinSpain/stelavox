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

import type { TurnEvent } from '@/lib/director/executor'

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
    case 'turn_complete':
      return {
        name: 'assistant_message_complete',
        payload: {
          assistant_message_id: event.assistant_message_id,
          stop_reason: event.stop_reason,
          tokens_input: event.usage.tokens_input,
          tokens_output: event.usage.tokens_output,
          tokens_cache_read: event.usage.tokens_cache_read,
          tokens_cache_write: event.usage.tokens_cache_write,
          cost_usd: event.cost_usd,
        },
      }
    case 'error':
      return {
        name: 'error',
        payload: { error: event.error, message: event.message },
      }
    case 'iteration_boundary':
      return null
    default:
      return null
  }
}
