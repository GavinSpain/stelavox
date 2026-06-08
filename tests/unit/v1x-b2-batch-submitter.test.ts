/**
 * V1.x-B.2.3 — batch submitter unit tests with mocked Anthropic SDK
 * + supabase.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §10.1 CK-18 / CK-19
 *         + lib/scheduler/batch-submitter.ts.
 *
 * Verifies:
 *   - When fewer than min_batch_size tickets are pending AND age <
 *     max_wait_minutes → no batch submitted; tickets buffered.
 *   - When tickets reach min_batch_size → batch submitted.
 *   - When age exceeds max_wait_minutes → batch submitted regardless
 *     of size (CK-19 override).
 *   - The Anthropic batch request body is shaped correctly: one
 *     BatchCreateParams.Request per ticket with custom_id = ticket.id
 *     and params = AssembledPrompt-derived shape.
 *   - On submit success: anthropic_batches row inserted; tickets get
 *     batch_anthropic_id + queue_status='dispatched'.
 *   - Pool isolation: BYOK tickets are NOT mixed with platform tickets
 *     in the same batch (B.2.3 substrate skips BYOK pools entirely;
 *     verified here as "BYOK pool not submitted").
 *
 * The full integration path (real DB + real Anthropic) is verified in
 * the user-driven launch test per project_launch_standard.md. These
 * unit tests guard the wire shape + buffer logic without external
 * dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Anthropic SDK BEFORE importing the submitter.
const mockBatchesCreate = vi.fn()
vi.mock('@anthropic-ai/sdk', () => {
  // Use a real class constructor — vitest's vi.fn() arrow-fn
  // implementation can't be invoked with `new`.
  function MockAnthropic() {
    return {
      messages: {
        batches: {
          create: mockBatchesCreate,
        },
      },
    }
  }
  return { default: MockAnthropic }
})

// Mock platform-config + supabase + job-lifecycle.
const mockGetConfig = vi.fn()
vi.mock('@/lib/config/platform-config', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
}))

interface MockAgentJob {
  id: string
  organisation_id: string
  document_id: string | null
  operation_type: string
  route: string
  user_id: string | null
  profile_id: string | null
  queued_at: string
  batch_anthropic_id?: string | null
  queue_status?: string
}

const mockJobsTable: MockAgentJob[] = []
const mockBatchesTable: Array<{ id: string; pool_key: string; request_count: number }> = []

// allowed_transitions rows the orchestration's CAS lookup expects to
// find for the events used downstream by the submitter (dispatcher_cas_claim
// + persist_running_start, used by transitionAgentJob + persistRunningStart
// during the dispatch+claim flow). Phase 8.5c: updated to match the
// post-Apollo orchestration shape.
const ALLOWED_TRANSITIONS_FAKE: Record<string, string[]> = {
  dispatcher_cas_claim: ['queued'],
  persist_running_start: ['dispatched'],
  runner_start_bypass: ['queued'],
}

const mockSupabase = {
  from: (table: string) => {
    if (table === 'agent_jobs') {
      return {
        select: () => ({
          eq: function (this: unknown, _col: string, _val: unknown) { return this },
          is: function (this: unknown, _col: string, _val: unknown) { return this },
          in: function (this: unknown, _col: string, _val: unknown) { return this },
          order: function (this: unknown, _col: string, _opts: unknown) { return this },
          maybeSingle: () => {
            // The CAS-protected UPDATE in transitionAgentJob ends with
            // .select('id, state').maybeSingle() to surface ok / cas_lost.
            // Return a minimal updated-row shape.
            return Promise.resolve({
              data: { id: 'fake-id', state: 'running' },
              error: null,
            })
          },
          then: (resolve: (v: { data: MockAgentJob[]; error: null }) => void) => {
            const filtered = mockJobsTable.filter(
              (j) => j.queue_status === 'queued' && (j.batch_anthropic_id ?? null) === null,
            )
            resolve({ data: filtered, error: null })
          },
        }),
        update: (rawPatch: Partial<MockAgentJob> & { state?: string }) => {
          // Auto-derive trigger emulation (Phase 8.5c): the real DB has
          // a trigger that maps state → queue_status. The orchestration
          // module writes the state column; this mock mirrors the sync
          // so tests asserting on the legacy queue_status column see the
          // expected dispatched/awaiting_accept/etc. values.
          const STATE_TO_QUEUE_STATUS: Record<string, string> = {
            queued: 'queued',
            dispatched: 'dispatched',
            running: 'running',
            awaiting_accept: 'completed',
            accepted: 'accepted',
            failed: 'failed',
            cancelled: 'cancelled',
            crashed: 'failed',
          }
          const patch: Partial<MockAgentJob> = { ...rawPatch }
          if (typeof rawPatch.state === 'string' && STATE_TO_QUEUE_STATUS[rawPatch.state]) {
            (patch as Partial<MockAgentJob>).queue_status = STATE_TO_QUEUE_STATUS[rawPatch.state]
          }
          // Chainable proxy — returns itself until a terminator
          // (maybeSingle or then) is awaited. Applies the patch in-place
          // to mock tickets on identifying filters (.eq('id', ...) or
          // .in('id', [...]).
          //
          // The transitionAgentJob CAS flow looks like:
          //   .update(payload).eq('id', X).in('state', [src,...])
          //     .select('id, state').maybeSingle()
          // The .in('state', ...) is the CAS guard; the .eq('id', X)
          // identifies the row to patch.
          const proxy: Record<string, unknown> = {
            in: function (col: string, ids: string[]) {
              if (col === 'id') {
                for (const j of mockJobsTable) {
                  if (ids.includes(j.id)) Object.assign(j, patch)
                }
              }
              return proxy
            },
            eq: function (col: string, val: unknown) {
              if (col === 'id' && typeof val === 'string') {
                for (const j of mockJobsTable) {
                  if (j.id === val) Object.assign(j, patch)
                }
              }
              return proxy
            },
            select: function () { return proxy },
            maybeSingle: () => {
              return Promise.resolve({
                data: { id: 'fake-id', state: patch.queue_status ?? 'running' },
                error: null,
              })
            },
            then: (resolve: (v: { data: null; error: null }) => void) => {
              resolve({ data: null, error: null })
            },
          }
          return proxy
        },
      }
    }
    if (table === 'anthropic_batches') {
      return {
        insert: (row: { id: string; pool_key: string; request_count: number }) => {
          mockBatchesTable.push(row)
          return Promise.resolve({ error: null })
        },
      }
    }
    if (table === 'allowed_transitions') {
      // casLookupSources calls .select('from_state').eq('entity_name', ...)
      // .eq('event_name', X).eq('to_state', ...). Return the source-state
      // list for the event_name filter.
      let filterEventName: string | null = null
      const proxy: Record<string, unknown> = {
        select: () => proxy,
        eq: (col: string, value: string) => {
          if (col === 'event_name') filterEventName = value
          return proxy
        },
        then: (resolve: (v: { data: Array<{ from_state: string }>; error: null }) => void) => {
          const sources = filterEventName ? (ALLOWED_TRANSITIONS_FAKE[filterEventName] ?? []) : []
          resolve({
            data: sources.map((s) => ({ from_state: s })),
            error: null,
          })
        },
      }
      return proxy
    }
    throw new Error(`unmocked table: ${table}`)
  },
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => mockSupabase,
}))

// Mock job-lifecycle to skip the real DB-loading complexity. The
// submitter only uses loadJobAndProfile + assembleAndPersistContext +
// persistRunningStart. We provide minimal stubs that return
// AssembledPrompt-shaped objects.
vi.mock('@/lib/agent/job-lifecycle', () => ({
  loadJobAndProfile: vi.fn(async (_supabase: unknown, jobId: string) => ({
    kind: 'ok',
    job: { id: jobId, organisation_id: 'org-a' },
    profile: { id: 'profile-a', operation_type: 'synthesise', model_id: 'claude-haiku-4-5' },
    dynamicCtx: {},
  })),
  assembleAndPersistContext: vi.fn(async () => ({
    stable: { systemPrompt: 'sys', ancestors: '', contextNodes: '', styleGuide: '', securityWrapped: 'wrapped sys' },
    dynamic: {
      currentNode: '',
      agentInstruction: '',
      editorialComments: '',
      precedingSiblings: '',
      succeedingSiblings: '',
      securityWrapped: 'user content',
      messages: [{ role: 'user', content: 'do thing' }],
    },
    config: { model: 'claude-haiku-4-5', temperature: 0.7, maxTokens: 4096, stream: false, operationType: 'synthesise' },
  })),
  persistRunningStart: vi.fn(async () => true),
}))

// Set ANTHROPIC_API_KEY for the SDK init.
beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-12345'
  mockJobsTable.length = 0
  mockBatchesTable.length = 0
  mockBatchesCreate.mockReset()
  mockGetConfig.mockReset()
  // Default config values mirroring M-114 + M-121.
  mockGetConfig.mockImplementation(async (key: string) => {
    if (key === 'agent.batched_24h_min_batch_size') return 5
    if (key === 'agent.batched_24h_max_wait_minutes') return 30
    if (key === 'agent.batched_24h_eligible_operations') return ['expand','synthesise','refine','generate_context']
    return undefined
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

import { submitReadyBatches } from '@/lib/scheduler/batch-submitter'

function makeTicket(idx: number, opts: Partial<MockAgentJob> = {}): MockAgentJob {
  return {
    id: `00000000-0000-0000-0000-${String(idx).padStart(12, '0')}`,
    organisation_id: 'org-a',
    document_id: 'doc-a',
    operation_type: 'synthesise',
    route: 'platform',
    user_id: null,
    profile_id: 'profile-a',
    queued_at: new Date(Date.now() - 60_000).toISOString(),
    queue_status: 'queued',
    batch_anthropic_id: null,
    ...opts,
  }
}

describe('submitReadyBatches — buffer behavior (CK-18)', () => {
  it('returns buffered count when fewer than min_batch_size tickets pending + below age threshold', async () => {
    // 3 tickets, age 1 min (below 30 min threshold), min_size=5 → buffer.
    for (let i = 0; i < 3; i++) mockJobsTable.push(makeTicket(i))

    const result = await submitReadyBatches()

    expect(mockBatchesCreate).not.toHaveBeenCalled()
    expect(result.batchesSubmitted).toBe(0)
    expect(result.ticketsSubmitted).toBe(0)
    expect(result.ticketsBuffered).toBe(3)
  })

  it('submits a batch when tickets reach min_batch_size', async () => {
    for (let i = 0; i < 5; i++) mockJobsTable.push(makeTicket(i))
    mockBatchesCreate.mockResolvedValue({ id: 'msgbatch_test_5' })

    const result = await submitReadyBatches()

    expect(mockBatchesCreate).toHaveBeenCalledTimes(1)
    const call = mockBatchesCreate.mock.calls[0][0] as { requests: Array<{ custom_id: string; params: Record<string, unknown> }> }
    expect(call.requests).toHaveLength(5)
    // Verify per-request shape: custom_id = ticket.id; params include model + max_tokens + messages.
    expect(call.requests[0].custom_id).toMatch(/^00000000-/)
    expect(call.requests[0].params.model).toBe('claude-haiku-4-5')
    expect(call.requests[0].params.max_tokens).toBe(4096)
    expect(Array.isArray(call.requests[0].params.messages)).toBe(true)

    expect(result.batchesSubmitted).toBe(1)
    expect(result.ticketsSubmitted).toBe(5)
    expect(mockBatchesTable).toHaveLength(1)
    expect(mockBatchesTable[0].id).toBe('msgbatch_test_5')
    expect(mockBatchesTable[0].pool_key).toBe('platform')
    expect(mockBatchesTable[0].request_count).toBe(5)

    // All 5 tickets got the batch_anthropic_id stamp + queue_status='dispatched'.
    for (const j of mockJobsTable) {
      expect(j.batch_anthropic_id).toBe('msgbatch_test_5')
      expect(j.queue_status).toBe('dispatched')
    }
  })
})

describe('submitReadyBatches — max_wait_minutes override (CK-19)', () => {
  it('submits a small batch when oldest ticket exceeds max_wait_minutes', async () => {
    // 2 tickets (below min_size=5) but oldest is 31 min old (> 30 min) → submit.
    const oldQueuedAt = new Date(Date.now() - 31 * 60_000).toISOString()
    mockJobsTable.push(makeTicket(0, { queued_at: oldQueuedAt }))
    mockJobsTable.push(makeTicket(1, { queued_at: oldQueuedAt }))
    mockBatchesCreate.mockResolvedValue({ id: 'msgbatch_test_age' })

    const result = await submitReadyBatches()

    expect(mockBatchesCreate).toHaveBeenCalledTimes(1)
    const call = mockBatchesCreate.mock.calls[0][0] as { requests: unknown[] }
    expect(call.requests).toHaveLength(2)
    expect(result.ticketsSubmitted).toBe(2)
  })
})

describe('submitReadyBatches — pool isolation', () => {
  it('skips BYOK pools (deferred to V1.x-C); only platform submits', async () => {
    // 5 platform + 5 BYOK tickets. Only platform should submit.
    for (let i = 0; i < 5; i++) mockJobsTable.push(makeTicket(i))
    for (let i = 5; i < 10; i++) {
      mockJobsTable.push(makeTicket(i, { route: 'byok', user_id: '11111111-1111-1111-1111-111111111111' }))
    }
    mockBatchesCreate.mockResolvedValue({ id: 'msgbatch_test_platform' })

    const result = await submitReadyBatches()

    expect(mockBatchesCreate).toHaveBeenCalledTimes(1)
    const call = mockBatchesCreate.mock.calls[0][0] as { requests: unknown[] }
    expect(call.requests).toHaveLength(5)
    expect(result.batchesSubmitted).toBe(1)
    expect(result.ticketsSubmitted).toBe(5)
  })
})
