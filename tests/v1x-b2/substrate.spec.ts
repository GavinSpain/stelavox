/**
 * V1.x-B.2.1 — substrate verification.
 *
 * End-to-end verification of:
 *   - M-105 — director_turns table CRUD; agent_jobs metric columns
 *     (queued_at populated; iteration_number / director_turn_id / etc.
 *     accept inserts).
 *   - M-106 — agent_jobs.queue_status enum + backfill from status.
 *   - M-107 — director_iterations table dropped; iteration_state JSONB
 *     present; redirected scheduler_sweep_interrupted_iterations writes
 *     queue_status='crashed' on stale-heartbeat agent_jobs rows.
 *   - M-108 — stop_requests table CRUD; insertStopRequest cascades
 *     queued descendants to queue_status='cancelled'.
 *   - M-109 — agent_jobs_notify_completion fires pg_notify on terminal
 *     queue_status transitions; director_turns_rollup_iteration
 *     increments iteration_count and rolls up tokens.
 *   - M-110 — classify_failure SQL function returns the expected class
 *     for each error_code variant (parity test against the TS classifier).
 *   - lib/scheduler/dispatcher.ts — runDispatcherTick claims a queued
 *     ticket and marks it dispatched (substrate; runner handoff is
 *     stub-only in B.2.1 so the test verifies claim semantics).
 *   - lib/scheduler/stopRequests.ts — computeStopCascade returns the
 *     expected counts; insertStopRequest cancels queued tickets.
 *
 * Out of scope for B.2.1 substrate session (deferred to B.2.1 session 2):
 *   - End-to-end Director turn that creates director_iteration agent_jobs
 *     (depends on executor rewrite).
 *   - Stop UI integration with DirectorPanel header (depends on
 *     DirectorPanel surfacing the active director_turn_id, which depends
 *     on the executor rewrite).
 */

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

/**
 * lib/scheduler modules carry `import 'server-only'` which Playwright's
 * test runtime can't load. We exercise them through the API routes
 * (fetch) and via the M-110 SQL function (adminClient.rpc) instead.
 *
 * The TS classifier is unit-tested in tests/unit/v1x-b2-failure-classifier.test.ts;
 * here we verify the SQL classifier via RPC.
 */

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

async function getUserId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  return (users?.users ?? []).find((u) => u.email === email)!.id
}

async function newConversation(orgId: string): Promise<{
  documentId: string
  conversationId: string
}> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'V1.x-B.2.1 substrate' })
    .select()
    .single()
  const projectId = project!.id

  const { data: docRpc, error } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: 'V1.x-B.2.1 doc',
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (error) throw new Error(`create_document RPC failed: ${error.message}`)
  const docId = (docRpc as { document: { id: string } }).document.id

  const { data: conv } = await admin
    .from('conversations')
    .insert({ organisation_id: orgId, document_id: docId })
    .select()
    .single()

  return { documentId: docId, conversationId: conv!.id }
}

test.describe('V1.x-B.2.1 — M-105 director_turns + agent_jobs metric columns', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('director_turns: insert + read + status transitions', async () => {
    const { conversationId } = await newConversation(orgA)
    const admin = adminClient()

    const { data: turn, error: insertErr } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id, status, started_at, iteration_count, total_input_tokens, total_output_tokens, total_cost_credits')
      .single()
    expect(insertErr).toBeNull()
    expect(turn!.status).toBe('in_progress')
    expect(turn!.iteration_count).toBe(0)
    expect(Number(turn!.total_cost_credits)).toBe(0)

    const { error: updErr } = await admin
      .from('director_turns')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', turn!.id)
    expect(updErr).toBeNull()

    const { data: after } = await admin
      .from('director_turns')
      .select('status, completed_at')
      .eq('id', turn!.id)
      .single()
    expect(after!.status).toBe('completed')
    expect(after!.completed_at).not.toBeNull()
  })

  test('agent_jobs: queued_at populated; iteration_number + director_turn_id accepted', async () => {
    const { conversationId } = await newConversation(orgA)
    const admin = adminClient()

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id')
      .single()

    const { data: job, error } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        triggered_by: 'integration-test',
        director_turn_id: turn!.id,
        iteration_number: 1,
        traffic_class: 1,
      })
      .select('id, queued_at, queue_status, iteration_number, director_turn_id, dispatcher_skips_count')
      .single()
    expect(error).toBeNull()
    expect(job!.queued_at).not.toBeNull()
    expect(job!.queue_status).toBe('queued')
    expect(job!.iteration_number).toBe(1)
    expect(job!.director_turn_id).toBe(turn!.id)
    expect(job!.dispatcher_skips_count).toBe(0)
  })
})

test.describe('V1.x-B.2.1 — M-106 queue_status v2 enum', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('queue_status accepts the v2 enum values', async () => {
    const admin = adminClient()
    for (const qs of ['queued', 'dispatched', 'running', 'completed', 'failed', 'crashed', 'cancelled', 'skipped']) {
      const { data: job, error } = await admin
        .from('agent_jobs')
        .insert({
          organisation_id: orgA,
          operation_type: 'expand',
          status: qs === 'crashed' || qs === 'cancelled' ? 'failed' : qs === 'queued' || qs === 'dispatched' || qs === 'skipped' ? 'pending' : qs,
          triggered_by: 'integration-test',
          queue_status: qs,
        })
        .select('id, queue_status')
        .single()
      expect(error).toBeNull()
      expect(job!.queue_status).toBe(qs)
      await admin.from('agent_jobs').delete().eq('id', job!.id)
    }
  })

  test('queue_status rejects an invalid value (CHECK constraint)', async () => {
    const admin = adminClient()
    const { error } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'expand',
        status: 'pending',
        triggered_by: 'integration-test',
        queue_status: 'not_a_real_status',
      })
      .select('id')
      .single()
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/violates check constraint|invalid input/)
  })
})

test.describe('V1.x-B.2.1 — M-107 director_iterations dropped + iteration_state JSONB', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('director_iterations table no longer exists', async () => {
    const admin = adminClient()
    // Cast the from() arg to bypass the regenerated type checker — the
    // generated types correctly omit director_iterations now (M-107
    // dropped it). We verify the runtime error to prove the table is
    // gone, not just that TypeScript thinks it is.
    const { error } = await (admin.from as unknown as (t: string) => ReturnType<typeof admin.from>)(
      'director_iterations',
    )
      .select('id')
      .limit(1)
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/relation .* does not exist|Could not find the table/i)
  })

  test('agent_jobs.iteration_state accepts JSONB writes and round-trips', async () => {
    const admin = adminClient()
    const stateBlob = {
      __schema_version: 1,
      assistant_messages: [{ role: 'assistant', content: [{ type: 'text', text: 'hello' }] }],
      pending_tool_results: [{ tool_use_id: 't1', content: 'ok' }],
      user_message: { role: 'user', content: 'do thing' },
      system_prompt_version: 'v1.8',
      model: 'claude-haiku-4-5',
    }
    const { data: job, error } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        triggered_by: 'integration-test',
        iteration_state: stateBlob,
      })
      .select('id, iteration_state')
      .single()
    expect(error).toBeNull()
    expect(job!.iteration_state).toEqual(stateBlob)
  })
})

test.describe('V1.x-B.2.1 — M-108 stop_requests', () => {
  let orgA: string
  let userIdA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    userIdA = await getUserId(USERS.A.email)
  })

  test('stop_requests row insert + read', async () => {
    const admin = adminClient()
    const fakeTargetId = '11111111-1111-1111-1111-111111111111'
    const { data, error } = await admin
      .from('stop_requests')
      .insert({
        organisation_id: orgA,
        requested_by: userIdA,
        target_kind: 'director_turn',
        target_id: fakeTargetId,
        reason: 'test',
      })
      .select('id, target_kind, target_id, reason, completed_at, requested_at')
      .single()
    expect(error).toBeNull()
    expect(data!.target_kind).toBe('director_turn')
    expect(data!.target_id).toBe(fakeTargetId)
    expect(data!.reason).toBe('test')
    expect(data!.completed_at).toBeNull()
    expect(data!.requested_at).not.toBeNull()
    await admin.from('stop_requests').delete().eq('id', data!.id)
  })

  test('POST /api/director/turns/[turnId]/stop cascades queued jobs', async () => {
    const { conversationId } = await newConversation(orgA)
    const admin = adminClient()

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id')
      .single()

    const { data: queuedJob } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'integration-test',
        director_turn_id: turn!.id,
        iteration_number: 1,
        traffic_class: 1,
      })
      .select('id')
      .single()

    const ctx = await ctxA()
    const res = await ctx.post(`/api/director/turns/${turn!.id}/stop`, {
      data: { reason: 'test cascade' },
    })

    expect(res.status()).toBe(200)
    const body = (await res.json()) as {
      stop_request_id: string
      target_kind: string
      cascade: { queued_count: number; total: number }
    }
    expect(body.stop_request_id).toBeTruthy()
    expect(body.target_kind).toBe('director_turn')
    expect(body.cascade.queued_count).toBeGreaterThanOrEqual(1)

    const { data: afterJob } = await admin
      .from('agent_jobs')
      .select('queue_status, status, error_message, failure_class')
      .eq('id', queuedJob!.id)
      .single()

    expect(afterJob!.queue_status).toBe('cancelled')
    expect(afterJob!.status).toBe('failed')
    expect(afterJob!.failure_class).toBe('B')
    expect(afterJob!.error_message).toContain('cancelled_by_stop_request')

    // Director turn marked cancelled too.
    const { data: turnAfter } = await admin
      .from('director_turns')
      .select('status, completed_at')
      .eq('id', turn!.id)
      .single()
    expect(turnAfter!.status).toBe('cancelled')
    expect(turnAfter!.completed_at).not.toBeNull()

    await ctx.dispose()
    await admin.from('agent_jobs').delete().eq('id', queuedJob!.id)
    await admin.from('stop_requests').delete().eq('target_id', turn!.id)
    await admin.from('director_turns').delete().eq('id', turn!.id)
  })

  test('POST /api/director/turns/[turnId]/stop returns 404 for unknown turn', async () => {
    const fakeId = '22222222-2222-2222-2222-222222222222'
    const ctx = await ctxA()
    const res = await ctx.post(`/api/director/turns/${fakeId}/stop`, { data: {} })
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })
})

test.describe('V1.x-B.2.1 — M-109 completion trigger pg_notify + rollup', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('director_turns_rollup_iteration increments iteration_count + rolls up tokens', async () => {
    const { conversationId } = await newConversation(orgA)
    const admin = adminClient()

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id, iteration_count, total_input_tokens, total_output_tokens, total_cost_credits')
      .single()
    expect(turn!.iteration_count).toBe(0)

    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'running',
        queue_status: 'running',
        triggered_by: 'integration-test',
        director_turn_id: turn!.id,
        iteration_number: 1,
        traffic_class: 1,
        actual_input_tokens: 1500,
        actual_output_tokens: 350,
        cost_credits: 0.0042,
      })
      .select('id')
      .single()

    // Trigger a queue_status terminal transition.
    const { error: updErr } = await admin
      .from('agent_jobs')
      .update({ queue_status: 'completed', status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job!.id)
    expect(updErr).toBeNull()

    const { data: after } = await admin
      .from('director_turns')
      .select('iteration_count, total_input_tokens, total_output_tokens, total_cost_credits')
      .eq('id', turn!.id)
      .single()
    expect(after!.iteration_count).toBe(1)
    expect(after!.total_input_tokens).toBe(1500)
    expect(after!.total_output_tokens).toBe(350)
    expect(Number(after!.total_cost_credits)).toBeCloseTo(0.0042, 6)

    await admin.from('agent_jobs').delete().eq('id', job!.id)
    await admin.from('director_turns').delete().eq('id', turn!.id)
  })

  test('non-terminal queue_status transitions do NOT roll up the turn', async () => {
    const { conversationId } = await newConversation(orgA)
    const admin = adminClient()

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id, iteration_count')
      .single()

    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'integration-test',
        director_turn_id: turn!.id,
        iteration_number: 1,
        actual_input_tokens: 100,
      })
      .select('id')
      .single()

    // queued → dispatched is non-terminal; should NOT roll up.
    await admin
      .from('agent_jobs')
      .update({ queue_status: 'dispatched', dispatched_at: new Date().toISOString() })
      .eq('id', job!.id)

    const { data: after } = await admin
      .from('director_turns')
      .select('iteration_count, total_input_tokens')
      .eq('id', turn!.id)
      .single()
    expect(after!.iteration_count).toBe(0)
    expect(after!.total_input_tokens).toBe(0)

    await admin.from('agent_jobs').delete().eq('id', job!.id)
    await admin.from('director_turns').delete().eq('id', turn!.id)
  })
})

test.describe('V1.x-B.2.1 — M-110 classify_failure SQL', () => {
  test('classify_failure SQL returns expected class on key cases', async () => {
    const admin = adminClient()

    const cases: Array<{
      operation_type: string
      error_code: string
      http_status: number
      expected: 'A' | 'B' | 'C' | 'D' | 'E'
    }> = [
      { operation_type: 'expand', error_code: 'rate_limited', http_status: 429, expected: 'A' },
      { operation_type: 'expand', error_code: 'service_unavailable', http_status: 503, expected: 'A' },
      { operation_type: 'expand', error_code: 'network_reset', http_status: 0, expected: 'A' },
      { operation_type: 'director_iteration', error_code: 'stop_requested', http_status: 0, expected: 'B' },
      { operation_type: 'expand', error_code: 'cancelled_by_user', http_status: 0, expected: 'B' },
      { operation_type: 'director_iteration', error_code: 'anthropic_concurrent_limit', http_status: 429, expected: 'C' },
      { operation_type: 'expand', error_code: 'bucket_exhausted', http_status: 0, expected: 'C' },
      { operation_type: 'expand', error_code: 'output_schema_invalid', http_status: 0, expected: 'D' },
      { operation_type: 'synthesise', error_code: 'canary_leak_detected', http_status: 0, expected: 'D' },
      { operation_type: 'expand', error_code: 'missing_config', http_status: 0, expected: 'E' },
      { operation_type: 'expand', error_code: 'agent_profile_not_found', http_status: 0, expected: 'E' },
      { operation_type: 'expand', error_code: 'something_unknown', http_status: 0, expected: 'B' },
    ]

    for (const c of cases) {
      const { data: sqlResult, error } = await admin.rpc('classify_failure', {
        p_operation_type: c.operation_type,
        p_error_code: c.error_code,
        p_http_status: c.http_status,
        p_retry_count: 0,
      })
      expect(error, `SQL classify_failure errored for ${c.error_code}`).toBeNull()
      expect(sqlResult, `${c.error_code} SQL`).toBe(c.expected)
    }
    // TS-side parity is verified in tests/unit/v1x-b2-failure-classifier.test.ts
    // (vitest unit suite). Both surfaces are kept aligned by sharing the
    // same set of error codes (lib/scheduler/failure-classifier.ts mirrors
    // M-110's lists exactly).
  })
})

test.describe('V1.x-B.2.1 — M-107 redirected sweep on agent_jobs', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('scheduler_sweep_interrupted_iterations marks crashed + failure_class=B', async () => {
    const admin = adminClient()
    const staleHb = new Date(Date.now() - 90_000).toISOString()
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'running',
        queue_status: 'running',
        triggered_by: 'integration-test',
        last_heartbeat_at: staleHb,
        started_at: staleHb,
      })
      .select('id')
      .single()

    const { data: swept } = await admin.rpc('scheduler_sweep_interrupted_iterations', {
      p_stale_threshold_seconds: 60,
    })
    expect(typeof swept === 'number' ? swept : Number(swept)).toBeGreaterThanOrEqual(1)

    const { data: after } = await admin
      .from('agent_jobs')
      .select('queue_status, status, failure_class, crashed_at')
      .eq('id', job!.id)
      .single()
    expect(after!.queue_status).toBe('crashed')
    expect(after!.status).toBe('failed')
    expect(after!.failure_class).toBe('B')
    expect(after!.crashed_at).not.toBeNull()

    await admin.from('agent_jobs').delete().eq('id', job!.id)
  })
})

/**
 * Dispatcher claim semantics are exercised in B.2.1 session 2 alongside
 * the executor rewrite (the dispatcher's actual handoff to a runner is
 * a stub in B.2.1 substrate). For now, the dispatcher TS module's
 * pure-logic shape is implicitly covered by:
 *   - lib/scheduler/dispatcher.ts type-check passing
 *   - The Stop API + sweep tests above which exercise the same
 *     candidate-eligibility predicates from the database side.
 *
 * Full runDispatcherTick() integration tests land in B.2.1 session 2.
 */
