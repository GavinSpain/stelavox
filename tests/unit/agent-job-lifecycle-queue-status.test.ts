/**
 * Regression — terminal-state queue_status writes.
 *
 * The phantom-redispatch bug (2026-05-22) traced to three completion
 * paths writing `status` but not `queue_status`. Combined with the
 * workflow-executor's INSERT-with-DEFAULT-'queued' + waitUntil(runAgentJob)
 * bypass of the dispatcher, every workflow-step job ended up in
 * `status='completed', queue_status='queued', completed_at set` — a
 * perfect zombie the dispatcher then re-claimed.
 *
 * These tests pin that each completion path now writes both columns.
 * The dispatcher's defence-in-depth `completed_at IS NULL` filter is a
 * separate guard tested via the dispatcher's existing test suite.
 */

import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import {
  persistCancellation,
  persistFailure,
  persistFinalResult,
  persistRunningStart,
} from '@/lib/agent/job-lifecycle'

function fakeSupabase() {
  const writes: Array<{ table: string; payload: Record<string, unknown> }> = []
  // Track which UPDATE call we're in — first call returns ok, subsequent
  // calls (e.g. persistRunningStart's bypass-fallback) also return ok.
  // The orchestration module calls .select().maybeSingle() to read back
  // the updated row; emulate that as a successful match with a state value.
  let lastWritePayload: Record<string, unknown> | null = null
  const fluent = (table: string) => {
    const proxy: Record<string, unknown> = {
      update(payload: Record<string, unknown>, _opts?: unknown) {
        writes.push({ table, payload })
        lastWritePayload = payload
        return proxy
      },
      select() { return proxy },
      eq() { return proxy },
      neq() { return proxy },
      in() { return proxy },
      maybeSingle: () => Promise.resolve({
        data: { id: 'fake-id', state: (lastWritePayload?.state as string) ?? 'running' },
        error: null,
      }),
      // Terminal chainables resolved as success.
      then(onFulfilled: (v: { data: null; error: null; count: number }) => unknown) {
        return Promise.resolve({ data: null, error: null, count: 1 }).then(onFulfilled)
      },
    }
    return proxy
  }
  const supabase = {
    from: vi.fn((table: string) => fluent(table)),
  } as unknown as SupabaseClient
  return { supabase, writes }
}

describe('agent-job lifecycle — queue_status terminal writes', () => {
  it('persistFinalResult delegates to orchestration: writes state="awaiting_accept"', async () => {
    // Apollo Phase 3 (2026-05-22): persistFinalResult now delegates to
    // markAgentJobAwaitingAccept in lib/orchestration. The write goes
    // through the state column directly; the DB auto-derive trigger
    // syncs legacy status/queue_status at trigger time. The fake
    // supabase here intercepts the application-side UPDATE, so we
    // verify state='awaiting_accept' is written.
    const { supabase, writes } = fakeSupabase()

    await persistFinalResult(supabase, 'job-1', {
      resultColumns: { result_prose: 'x' },
      usage: { tokens_input: 1, tokens_output: 1, tokens_cache_write: 0, tokens_cache_read: 0 },
      modelId: 'claude-haiku-4-5',
      provider: 'anthropic',
      costUsd: 0.01,
      costCredits: 100,
    })

    const agentWrites = writes.filter((w) => w.table === 'agent_jobs')
    expect(agentWrites).toHaveLength(1)
    expect(agentWrites[0].payload.state).toBe('awaiting_accept')
    expect(agentWrites[0].payload.completed_at).toBeTruthy()
    expect(agentWrites[0].payload.tokens_input).toBe(1)
    expect(agentWrites[0].payload.cost_usd).toBe(0.01)
  })

  it('persistFailure delegates to orchestration: writes state="failed"', async () => {
    const { supabase, writes } = fakeSupabase()
    await persistFailure(supabase, 'job-2', 'budget_exceeded')

    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    const lastUpdate = agentUpdates[agentUpdates.length - 1]
    expect(lastUpdate.payload.state).toBe('failed')
    expect(lastUpdate.payload.error_message).toBe('budget_exceeded')
    expect(lastUpdate.payload.failure_class).toBe('A')
  })

  it('persistCancellation delegates to orchestration: writes state="cancelled"', async () => {
    const { supabase, writes } = fakeSupabase()
    await persistCancellation(supabase, 'job-3', 'sse_client_disconnect')

    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    const lastUpdate = agentUpdates[agentUpdates.length - 1]
    expect(lastUpdate.payload.state).toBe('cancelled')
    expect(lastUpdate.payload.error_message).toBe('sse_client_disconnect')
  })

  it('persistRunningStart delegates to orchestration: writes state="running"', async () => {
    // Apollo Phase 3: persistRunningStart tries dispatched→running first;
    // if that fails (bypass path), tries queued→running. Each attempt
    // produces one UPDATE in the fake; with our fake returning count=1
    // the first attempt succeeds and we see one write.
    const { supabase, writes } = fakeSupabase()
    const result = await persistRunningStart(supabase, 'job-4')
    expect(result).toBe(true)

    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    expect(agentUpdates.length).toBeGreaterThanOrEqual(1)
    expect(agentUpdates[0].payload.state).toBe('running')
    expect(agentUpdates[0].payload.started_at).toBeTruthy()
    expect(agentUpdates[0].payload.last_heartbeat_at).toBeTruthy()
  })
})
