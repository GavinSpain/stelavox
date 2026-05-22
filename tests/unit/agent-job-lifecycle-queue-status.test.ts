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
  const fluent = (table: string) => {
    const proxy: Record<string, unknown> = {
      update(payload: Record<string, unknown>, _opts?: unknown) {
        writes.push({ table, payload })
        return proxy
      },
      select() { return proxy },
      eq() { return proxy },
      neq() { return proxy },
      in() { return proxy },
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      // Terminal chainables resolved as success. persistRunningStart asks
      // for { count: 'exact' }; emulate count=1 so the function returns
      // true ("claimed").
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
  it('persistFinalResult writes queue_status="completed"', async () => {
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
    expect(agentWrites[0].payload.status).toBe('completed')
    expect(agentWrites[0].payload.queue_status).toBe('completed')
    expect(agentWrites[0].payload.completed_at).toBeTruthy()
  })

  it('persistFailure writes queue_status="failed"', async () => {
    const { supabase, writes } = fakeSupabase()
    await persistFailure(supabase, 'job-2', 'budget_exceeded')

    // persistFailure does a SELECT then an UPDATE; only the UPDATE writes.
    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    // SELECT-then-UPDATE shape: writes[] catches updates only.
    const lastUpdate = agentUpdates[agentUpdates.length - 1]
    expect(lastUpdate.payload.status).toBe('failed')
    expect(lastUpdate.payload.queue_status).toBe('failed')
    expect(lastUpdate.payload.error_message).toBe('budget_exceeded')
  })

  it('persistCancellation writes queue_status="cancelled"', async () => {
    const { supabase, writes } = fakeSupabase()
    await persistCancellation(supabase, 'job-3', 'sse_client_disconnect')

    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    const lastUpdate = agentUpdates[agentUpdates.length - 1]
    expect(lastUpdate.payload.status).toBe('cancelled')
    expect(lastUpdate.payload.queue_status).toBe('cancelled')
    expect(lastUpdate.payload.error_message).toBe('sse_client_disconnect')
  })

  it('persistRunningStart writes queue_status="running" alongside status', async () => {
    // User surfaced 2026-05-22 on "Into the Ice" stage 2: the dispatcher's
    // CAS was writing status='running' as part of its claim, which made
    // the runner's loadJobAndProfile return job_not_pending and skip the
    // job. The fix is two-part — the dispatcher drops status='running'
    // from its claim, and the runner's persistRunningStart now mirrors
    // M-106's documented lifecycle by transitioning BOTH columns to
    // 'running' as the runner starts work. This test pins the runner
    // half (the dispatcher half is enforced by code review + the
    // ordering invariant in dispatcher.ts:235-256).
    const { supabase, writes } = fakeSupabase()
    const result = await persistRunningStart(supabase, 'job-4')
    expect(result).toBe(true)

    const agentUpdates = writes.filter((w) => w.table === 'agent_jobs')
    expect(agentUpdates).toHaveLength(1)
    expect(agentUpdates[0].payload.status).toBe('running')
    expect(agentUpdates[0].payload.queue_status).toBe('running')
    expect(agentUpdates[0].payload.started_at).toBeTruthy()
    expect(agentUpdates[0].payload.last_heartbeat_at).toBeTruthy()
  })
})
