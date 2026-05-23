/**
 * V1.x-B.2.1 session 2 — per-iteration Director model.
 *
 * CK-1 (per-iteration chain): a Director turn that proceeds through N
 *   iterations creates N agent_jobs rows of operation_type='director_iteration'
 *   under the same director_turn_id, with sequential iteration_number
 *   and chained parent_iteration_id.
 *
 * CK-3 (Stop cascade end-to-end): mid-turn Stop request cascades the
 *   director_turn to status='cancelled' AND any queued descendant
 *   agent_jobs of the same director_turn to queue_status='cancelled'.
 *
 * Both tests synthesise the agent_jobs/director_turns rows directly
 * rather than driving an actual Director turn (which requires a live
 * Anthropic call). The full end-to-end LLM flow is exercised by
 * tests/director/j5-director-turn.spec.ts (the wire-shape smoke).
 */

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

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

async function newConversation(orgId: string): Promise<{ documentId: string; conversationId: string }> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'V1.x-B.2.1 session 2' })
    .select()
    .single()
  const { data: docRpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: 'session-2 doc',
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const docId = (docRpc as { document: { id: string } }).document.id
  const { data: conv } = await admin
    .from('conversations')
    .insert({ organisation_id: orgId, document_id: docId })
    .select()
    .single()
  return { documentId: docId, conversationId: conv!.id }
}

test.describe('V1.x-B.2.1 session 2 — CK-1 per-iteration chain', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('a 3-iteration turn creates 3 agent_jobs with chained parent_iteration_id', async () => {
    const admin = adminClient()
    const { conversationId } = await newConversation(orgA)

    // Create the director_turns row + first iteration job (mimics
    // startDirectorTurn).
    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id')
      .single()
    const turnId = turn!.id

    const { data: iter1 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'integration-test',
        traffic_class: 1,
        director_turn_id: turnId,
        parent_iteration_id: null,
        iteration_number: 1,
        iteration_state: { __schema_version: 1, conversation_context: [], messages: [{ role: 'user', content: 'probe' }], user_message: { role: 'user', content: 'probe' }, system_prompt_version: 'v1.8', model: 'claude-haiku-4-5' },
      })
      .select('id')
      .single()

    // Mimic iteration 1 → completes with tool_use → enqueues iteration 2.
    const { data: iter2 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'iteration_chain',
        traffic_class: 1,
        director_turn_id: turnId,
        parent_iteration_id: iter1!.id,
        iteration_number: 2,
        iteration_state: { __schema_version: 1, conversation_context: [], messages: [], user_message: { role: 'user', content: 'probe' }, system_prompt_version: 'v1.8', model: 'claude-haiku-4-5' },
      })
      .select('id')
      .single()

    const { data: iter3 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'iteration_chain',
        traffic_class: 1,
        director_turn_id: turnId,
        parent_iteration_id: iter2!.id,
        iteration_number: 3,
        iteration_state: { __schema_version: 1, conversation_context: [], messages: [], user_message: { role: 'user', content: 'probe' }, system_prompt_version: 'v1.8', model: 'claude-haiku-4-5' },
      })
      .select('id')
      .single()

    // Verify chain: 3 rows, sequential iteration_number, chained parent.
    const { data: chain } = await admin
      .from('agent_jobs')
      .select('id, iteration_number, parent_iteration_id, director_turn_id')
      .eq('director_turn_id', turnId)
      .order('iteration_number', { ascending: true })

    expect(chain).toHaveLength(3)
    expect(chain![0].iteration_number).toBe(1)
    expect(chain![0].parent_iteration_id).toBeNull()
    expect(chain![1].iteration_number).toBe(2)
    expect(chain![1].parent_iteration_id).toBe(chain![0].id)
    expect(chain![2].iteration_number).toBe(3)
    expect(chain![2].parent_iteration_id).toBe(chain![1].id)
    // All share the same director_turn_id.
    for (const row of chain!) expect(row.director_turn_id).toBe(turnId)

    // Cleanup.
    await admin.from('agent_jobs').delete().in('id', [iter1!.id, iter2!.id, iter3!.id])
    await admin.from('director_turns').delete().eq('id', turnId)
  })

  test('director_turns_rollup_iteration aggregates token counts across multiple iterations', async () => {
    const admin = adminClient()
    const { conversationId } = await newConversation(orgA)

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id, iteration_count, total_input_tokens, total_output_tokens, total_cost_credits')
      .single()
    const turnId = turn!.id

    // Insert + complete iteration 1 (running → completed transition fires the trigger).
    const { data: i1 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'running',
        queue_status: 'running',
        triggered_by: 'integration-test',
        director_turn_id: turnId,
        iteration_number: 1,
        actual_input_tokens: 1000,
        actual_output_tokens: 200,
        cost_credits: 0.001,
      })
      .select('id')
      .single()
    await admin.from('agent_jobs').update({ queue_status: 'completed', status: 'completed', completed_at: new Date().toISOString() }).eq('id', i1!.id)

    const { data: i2 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'running',
        queue_status: 'running',
        triggered_by: 'iteration_chain',
        director_turn_id: turnId,
        parent_iteration_id: i1!.id,
        iteration_number: 2,
        actual_input_tokens: 2000,
        actual_output_tokens: 500,
        cost_credits: 0.003,
      })
      .select('id')
      .single()
    await admin.from('agent_jobs').update({ queue_status: 'completed', status: 'completed', completed_at: new Date().toISOString() }).eq('id', i2!.id)

    const { data: after } = await admin
      .from('director_turns')
      .select('iteration_count, total_input_tokens, total_output_tokens, total_cost_credits')
      .eq('id', turnId)
      .single()
    expect(after!.iteration_count).toBe(2)
    expect(after!.total_input_tokens).toBe(3000)
    expect(after!.total_output_tokens).toBe(700)
    expect(Number(after!.total_cost_credits)).toBeCloseTo(0.004, 6)

    await admin.from('agent_jobs').delete().in('id', [i1!.id, i2!.id])
    await admin.from('director_turns').delete().eq('id', turnId)
  })
})

test.describe('V1.x-B.2.1 session 2 — CK-3 Stop cascade end-to-end', () => {
  let orgA: string
  let userIdA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    userIdA = await getUserId(USERS.A.email)
  })

  test('Stop on a turn cancels in-flight + queued descendants atomically', async () => {
    const admin = adminClient()
    const { conversationId } = await newConversation(orgA)

    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: conversationId })
      .select('id')
      .single()
    const turnId = turn!.id

    // 1 in-flight (running) iteration + 1 queued iteration.
    //
    // M-205: consumer_kind='inline_route' makes the test rows invisible
    // to the dispatcher. Pre-fix the dispatcher's INSERT NOTIFY trigger
    // would wake the listener and race to claim i2 (queued → dispatched)
    // before the stop request fires, making computeStopCascade return
    // queued_count=0 (because i2 has already moved out of 'queued'). The
    // test's intent is to verify the Stop cascade behaviour, not the
    // dispatcher's race; marking these rows as inline_route gives the
    // test exclusive ownership of their lifecycle.
    const { data: i1 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'running',
        queue_status: 'running',
        triggered_by: 'integration-test',
        director_turn_id: turnId,
        iteration_number: 1,
        last_heartbeat_at: new Date().toISOString(),
        consumer_kind: 'inline_route',
      })
      .select('id')
      .single()
    const { data: i2 } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_iteration',
        status: 'pending',
        queue_status: 'queued',
        triggered_by: 'iteration_chain',
        director_turn_id: turnId,
        parent_iteration_id: i1!.id,
        iteration_number: 2,
        consumer_kind: 'inline_route',
      })
      .select('id')
      .single()

    // File a Stop request via the API.
    const { request } = await import('@playwright/test')
    const ctx = await request.newContext({ baseURL: 'http://localhost:3000', storageState: USERS.A.storageState })
    try {
      const res = await ctx.post(`/api/director/turns/${turnId}/stop`, { data: { reason: 'CK-3 test' } })
      expect(res.status()).toBe(200)
      const body = (await res.json()) as { stop_request_id: string; cascade: { in_flight_count: number; queued_count: number; total: number } }
      expect(body.stop_request_id).toBeTruthy()
      expect(body.cascade.in_flight_count).toBeGreaterThanOrEqual(1)
      expect(body.cascade.queued_count).toBeGreaterThanOrEqual(1)
    } finally {
      await ctx.dispose()
    }

    // Queued iteration → cancelled. M-205: cancelQueuedTicketsForStop
    // now routes through transitionAgentJob (queued → cancelled). The
    // auto_derive trigger normalises status + queue_status to match
    // state='cancelled'. Pre-Apollo direct UPDATE wrote (failed,
    // cancelled) — a contradictory tuple Apollo collapses to either
    // (failed, failed) or (cancelled, cancelled) depending on derive
    // direction. Post-M-205 we want the legal 'cancelled' state.
    const { data: iter2After } = await admin
      .from('agent_jobs')
      .select('state, queue_status, status, failure_class, error_message')
      .eq('id', i2!.id)
      .single()
    expect(iter2After!.state).toBe('cancelled')
    expect(iter2After!.queue_status).toBe('cancelled')
    expect(iter2After!.status).toBe('cancelled')
    expect(iter2After!.failure_class).toBe('B')
    expect(iter2After!.error_message).toBe('cancelled_by_stop_request')

    // Director turn → cancelled.
    const { data: turnAfter } = await admin
      .from('director_turns')
      .select('status, completed_at')
      .eq('id', turnId)
      .single()
    expect(turnAfter!.status).toBe('cancelled')
    expect(turnAfter!.completed_at).not.toBeNull()

    // The in-flight iteration row stays running until its runner observes
    // the stop (cooperative-abort) — the API doesn't force-cancel
    // running rows. The dispatcher's notStopRequested predicate would
    // catch it on next tick if it's a queued row; running rows are the
    // runner's responsibility. Documented in iteration-runner.ts H-25
    // mitigation comments.
    const { data: iter1After } = await admin
      .from('agent_jobs')
      .select('queue_status')
      .eq('id', i1!.id)
      .single()
    expect(['running', 'cancelled']).toContain(iter1After!.queue_status)

    // Cleanup.
    await admin.from('agent_jobs').delete().in('id', [i1!.id, i2!.id])
    await admin.from('stop_requests').delete().eq('target_id', turnId)
    await admin.from('director_turns').delete().eq('id', turnId)
    void userIdA
  })
})
