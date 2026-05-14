/**
 * V1.x-B.1.1 session 3a — buildConversationContext system-event rendering.
 *
 * Pure-TypeScript unit test of the renderSystemEventForContext helper
 * shape (verified via the prefix the model recognises). Integration
 * test for the DB query path lives in the Playwright spec.
 */

import { describe, expect, it } from 'vitest'

// The renderer is module-private; re-export through a thin test surface.
// Easier path: test the contract by calling buildConversationContext
// against a mocked supabase client. Doing it inline here.
import { buildConversationContext } from '@/lib/director/conversation-context'

describe('buildConversationContext — system event rendering', () => {
  it('synthesises role=system rows as user messages with [SYSTEM EVENT:] prefix', async () => {
    const supabase = mockSupabase({
      conversation: { conversation_summary: null, summary_covers_through: null },
      messages: [
        { role: 'user', content: 'Plan act 2', sequence: 1, turn_state: 'final', event_type: null, event_payload: null, cause: null },
        { role: 'assistant', content: 'Brief proposed', sequence: 2, turn_state: 'final', event_type: null, event_payload: null, cause: null },
        {
          role: 'system',
          content: 'Stage 2 "Expand first scene into beats" trigger fired — Director should plan its workflow.',
          sequence: 3,
          turn_state: 'final',
          event_type: 'stage_trigger_fired',
          event_payload: { brief_id: 'brief-1', stage_id: 'stage-2', stage_order: 2, stage_title: 'Expand first scene into beats' },
          cause: 'scheduler_trigger',
        },
      ],
    })

    const result = await buildConversationContext(supabase as never, 'conv-1')

    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ role: 'user', content: 'Plan act 2' })
    expect(result[1]).toEqual({ role: 'assistant', content: 'Brief proposed' })

    // System event surfaced as user message with the [SYSTEM EVENT:] prefix.
    expect(result[2].role).toBe('user')
    expect(result[2].content).toMatch(/^\[SYSTEM EVENT: stage_trigger_fired/)
    expect(result[2].content).toContain('cause=scheduler_trigger')
    expect(result[2].content).toContain('"stage_order":2')
    expect(result[2].content).toContain('Stage 2 "Expand first scene into beats" trigger fired')
  })

  it('omits role=system rows that have no event_type (defensive)', async () => {
    const supabase = mockSupabase({
      conversation: { conversation_summary: null, summary_covers_through: null },
      messages: [
        { role: 'user', content: 'Hi', sequence: 1, turn_state: 'final', event_type: null, event_payload: null, cause: null },
        // Malformed: role=system but event_type missing — DB CHECK should
        // prevent this in production but be defensive in case of legacy rows.
        { role: 'system', content: 'malformed', sequence: 2, turn_state: 'final', event_type: null, event_payload: null, cause: null },
      ],
    })

    const result = await buildConversationContext(supabase as never, 'conv-2')
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({ role: 'user', content: 'Hi' })
  })

  it('renders payload-less system events without a payload= clause', async () => {
    const supabase = mockSupabase({
      conversation: { conversation_summary: null, summary_covers_through: null },
      messages: [
        {
          role: 'system',
          content: 'Brief activated from queue (position 1).',
          sequence: 1,
          turn_state: 'final',
          event_type: 'brief_activated',
          event_payload: {},
          cause: 'sequence_promotion',
        },
      ],
    })

    const result = await buildConversationContext(supabase as never, 'conv-3')
    expect(result).toHaveLength(1)
    expect(result[0].content).toMatch(/^\[SYSTEM EVENT: brief_activated cause=sequence_promotion\]/)
    expect(result[0].content).not.toContain('payload=')
  })
})

// Minimal Supabase chain mock for buildConversationContext's two
// separate query paths (conversations.maybeSingle + conversation_messages
// .select.eq.in.order, optionally .gt).
function mockSupabase(payload: {
  conversation: { conversation_summary: string | null; summary_covers_through: number | null }
  messages: Array<{
    role: string
    content: string
    sequence: number
    turn_state: string
    event_type: string | null
    event_payload: Record<string, unknown> | null
    cause: string | null
  }>
}) {
  return {
    from(table: string) {
      if (table === 'conversations') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: payload.conversation, error: null }),
                }
              },
            }
          },
        }
      }
      if (table === 'conversation_messages') {
        const chain = {
          select() { return chain },
          eq() { return chain },
          in() { return chain },
          order() { return chain },
          gt() { return chain },
          then(resolve: (v: { data: typeof payload.messages; error: null }) => void) {
            resolve({ data: payload.messages, error: null })
          },
        }
        return chain
      }
      if (table === 'platform_config') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({ data: null, error: null }),
                }
              },
            }
          },
        }
      }
      throw new Error(`unexpected table: ${table}`)
    },
  }
}
