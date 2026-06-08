/**
 * Phase 8.5b B.5 — Realtime demuxer unit tests.
 *
 * Pins the architectural contract of lib/realtime/demuxer.ts: events
 * dispatch by topic; subscribers can filter; multiple subscribers per
 * topic each fire; unsubscribe cleanly removes; one bad listener doesn't
 * break the bus; the topic-name union covers REALTIME_TOPICS.
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §5 (TC-8.5b-B5-01..06)
 *       docs/stelavox_document_load_architecture_v1_0.md §5.2 §5.3
 */

import { describe, expect, it, beforeEach, vi } from 'vitest'

import {
  subscribe,
  dispatch,
  REALTIME_TOPICS,
  __resetDemuxerForTest,
  __subscriberCountForTest,
  type RealtimeTopicPayload,
} from '@/lib/realtime/demuxer'

function makePayload<Row = Record<string, unknown>>(
  overrides: Partial<RealtimeTopicPayload<Row>> = {},
): RealtimeTopicPayload<Row> {
  return {
    eventType: 'UPDATE',
    new: {} as Row,
    old: {},
    schema: 'public',
    table: 'nodes',
    ...overrides,
  } as RealtimeTopicPayload<Row>
}

describe('Phase 8.5b B.5 — Realtime demuxer', () => {
  beforeEach(() => {
    __resetDemuxerForTest()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-01 — Demuxer routes events to topic subscribers.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-01 — routes nodes event to subscribers registered for nodes', () => {
    const cb = vi.fn()
    subscribe('nodes', cb)
    dispatch('nodes', makePayload({ new: { id: 'X' } }))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0]![0]).toMatchObject({ new: { id: 'X' } })
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-02 — Subscriber filter narrows the events that fire.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-02 — subscriber filter prevents non-matching dispatch', () => {
    const cb = vi.fn()
    subscribe<Record<string, unknown>>('nodes', cb, (p) => (p.new as { document_id?: string }).document_id === 'A')
    dispatch('nodes', makePayload({ new: { document_id: 'B' } }))
    expect(cb).not.toHaveBeenCalled()
    dispatch('nodes', makePayload({ new: { document_id: 'A' } }))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-03 — Multiple subscribers for same topic each receive.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-03 — multiple subscribers for the same topic each receive the event', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribe('briefs', a)
    subscribe('briefs', b)
    dispatch('briefs', makePayload({ table: 'briefs' }))
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-04 — Unsubscribe cleanly removes.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-04 — unsubscribe returns a function that cleanly removes', () => {
    const cb = vi.fn()
    const unsub = subscribe('agent_jobs', cb)
    expect(__subscriberCountForTest('agent_jobs')).toBe(1)
    unsub()
    expect(__subscriberCountForTest('agent_jobs')).toBe(0)
    dispatch('agent_jobs', makePayload({ table: 'agent_jobs' }))
    expect(cb).not.toHaveBeenCalled()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-05 — Dispatch with no subscribers is a no-op.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-05 — dispatch with no subscribers does not throw', () => {
    expect(() => dispatch('export_jobs', makePayload({ table: 'export_jobs' }))).not.toThrow()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-06 — Multiple topics route independently.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-06 — topics route independently', () => {
    const nodesCb = vi.fn()
    const briefsCb = vi.fn()
    subscribe('nodes', nodesCb)
    subscribe('briefs', briefsCb)
    dispatch('nodes', makePayload({ table: 'nodes' }))
    expect(nodesCb).toHaveBeenCalledTimes(1)
    expect(briefsCb).not.toHaveBeenCalled()
    dispatch('briefs', makePayload({ table: 'briefs' }))
    expect(briefsCb).toHaveBeenCalledTimes(1)
    expect(nodesCb).toHaveBeenCalledTimes(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-07 — A throwing subscriber does not break the bus.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-07 — one bad listener does not break the bus', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = vi.fn(() => { throw new Error('bad') })
    const good = vi.fn()
    subscribe('briefs', bad)
    subscribe('briefs', good)
    expect(() => dispatch('briefs', makePayload({ table: 'briefs' }))).not.toThrow()
    expect(bad).toHaveBeenCalled()
    expect(good).toHaveBeenCalled()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B5-08 — REALTIME_TOPICS covers exactly 12 entries with the
  // expected names. Soft cap raised to 12 per Tier-A §5.3 changelog of
  // 2026-06-08. Cap raise rationale: workflows + workflow_steps are
  // core Director functionality with no fall-back signal in any other
  // multiplexed topic; carrying them on the user channel is strictly
  // cheaper than keeping a per-tab Director channel.
  // ───────────────────────────────────────────────────────────────────
  it('TC-8.5b-B5-08 — REALTIME_TOPICS list is stable and within soft cap', () => {
    expect(REALTIME_TOPICS.length).toBeLessThanOrEqual(12)
    expect(new Set(REALTIME_TOPICS)).toEqual(new Set([
      'nodes', 'agent_jobs', 'briefs', 'brief_stages',
      'conversation_messages', 'director_turns', 'export_jobs',
      'project_profiles', 'profile_amendments',
      // B.5b — for CostMeterFull. organisations row events fire when
      // the accumulate_cost_credits_into_org trigger updates
      // tokens_used / cost_credits.
      'organisations',
      // B.5c — for useDirectorConversation. workflows row INSERT on
      // user Approve has no fall-back signal in any other topic; the
      // dispatcher's agent_jobs INSERT lands asynchronously.
      'workflows',
      'workflow_steps',
    ]))
  })
})
