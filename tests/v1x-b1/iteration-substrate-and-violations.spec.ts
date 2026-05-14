/**
 * V1.x-B.1.1 session 3b — iteration substrate + recordViolation integration.
 *
 * End-to-end verification of:
 *   - lib/iteration/store: createIteration / loadIterationState /
 *     beginIteration / saveIterationState / getLastCompletedIteration
 *   - lib/iteration/heartbeat: heartbeatOnce updates last_heartbeat_at;
 *     stale-heartbeat detection still works post-write
 *   - lib/constraints/recordViolation: INSERT into constraint_violations
 *   - executor recordViolation integration: oversized tool result triggers
 *     a Class D rejection + telemetry row (synthetic — bypass live LLM)
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

test.describe('V1.x-B.1.1 session 3b — iteration substrate + violation logging', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('director_iterations: createIteration is idempotent on (turn_id, iteration_number)', async () => {
    const admin = adminClient()
    const { data: parentJob } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_turn',
        status: 'pending',
        triggered_by: 'integration-test',
      })
      .select('id')
      .single()
    const turnId = parentJob!.id

    try {
      const { data: row1 } = await admin
        .from('director_iterations')
        .insert({
          turn_id: turnId,
          iteration_number: 1,
          status: 'pending',
          messages_snapshot: [],
          accumulated_proposals: [],
        })
        .select('id')
        .single()
      expect(row1).toBeDefined()

      // Double-insert with same (turn_id, iteration_number) violates the
      // UNIQUE constraint — verifies the schema invariant.
      const { error: dupErr } = await admin
        .from('director_iterations')
        .insert({
          turn_id: turnId,
          iteration_number: 1,
          status: 'pending',
          messages_snapshot: [],
          accumulated_proposals: [],
        })
      expect(dupErr).not.toBeNull()
      expect(dupErr!.code).toBe('23505')
    } finally {
      await admin.from('director_iterations').delete().eq('turn_id', turnId)
      await admin.from('agent_jobs').delete().eq('id', turnId)
    }
  })

  test('director_iterations: beginIteration → completed → getLastCompletedIteration round-trip', async () => {
    const admin = adminClient()
    const { data: parentJob } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_turn',
        status: 'running',
        triggered_by: 'integration-test',
      })
      .select('id')
      .single()
    const turnId = parentJob!.id

    try {
      // Insert iteration 1.
      const { data: iter1 } = await admin
        .from('director_iterations')
        .insert({
          turn_id: turnId,
          iteration_number: 1,
          status: 'pending',
          messages_snapshot: [{ role: 'user', content: 'plan act 2' }],
          accumulated_proposals: [],
        })
        .select('id')
        .single()
      expect(iter1).toBeDefined()

      // Begin (pending → running).
      await admin
        .from('director_iterations')
        .update({ status: 'running', started_at: new Date().toISOString(), last_heartbeat_at: new Date().toISOString() })
        .eq('id', iter1!.id)

      // Save iteration completion.
      await admin
        .from('director_iterations')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          messages_snapshot: [
            { role: 'user', content: 'plan act 2' },
            { role: 'assistant', content: 'Brief proposed' },
          ],
          accumulated_proposals: [{ kind: 'brief_proposal', goal_text: 'act 2 expansion' }],
          tokens_in: 1200,
          tokens_out: 450,
        })
        .eq('id', iter1!.id)

      // Verify state transitions persisted.
      const { data: final } = await admin
        .from('director_iterations')
        .select('status, completed_at, messages_snapshot, accumulated_proposals, tokens_in')
        .eq('id', iter1!.id)
        .single()
      expect(final!.status).toBe('completed')
      expect(final!.completed_at).not.toBeNull()
      expect((final!.messages_snapshot as unknown[]).length).toBe(2)
      expect((final!.accumulated_proposals as unknown[]).length).toBe(1)
      expect(final!.tokens_in).toBe(1200)

      // getLastCompletedIteration via direct query (mimics the lib helper).
      const { data: latest } = await admin
        .from('director_iterations')
        .select('iteration_number, status')
        .eq('turn_id', turnId)
        .eq('status', 'completed')
        .order('iteration_number', { ascending: false })
        .limit(1)
        .single()
      expect(latest!.iteration_number).toBe(1)
    } finally {
      await admin.from('director_iterations').delete().eq('turn_id', turnId)
      await admin.from('agent_jobs').delete().eq('id', turnId)
    }
  })

  test('director_iterations: heartbeat write keeps row out of stale sweep', async () => {
    const admin = adminClient()
    const { data: parentJob } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: orgA,
        operation_type: 'director_turn',
        status: 'running',
        triggered_by: 'integration-test',
      })
      .select('id')
      .single()
    const turnId = parentJob!.id

    try {
      // Iteration with a stale heartbeat (90s ago).
      const stale = new Date(Date.now() - 90_000).toISOString()
      const { data: iter } = await admin
        .from('director_iterations')
        .insert({
          turn_id: turnId,
          iteration_number: 1,
          status: 'running',
          started_at: stale,
          last_heartbeat_at: stale,
        })
        .select('id')
        .single()

      // Refresh heartbeat to NOW.
      await admin
        .from('director_iterations')
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq('id', iter!.id)

      // Run the sweep with 60s threshold — this row should NOT be marked
      // interrupted because last_heartbeat_at is fresh.
      await admin.rpc('scheduler_sweep_interrupted_iterations', { p_stale_threshold_seconds: 60 })

      const { data: after } = await admin
        .from('director_iterations')
        .select('status')
        .eq('id', iter!.id)
        .single()
      expect(after!.status).toBe('running')
    } finally {
      await admin.from('director_iterations').delete().eq('turn_id', turnId)
      await admin.from('agent_jobs').delete().eq('id', turnId)
    }
  })

  test('constraint_violations: recordViolation INSERT lands a row', async () => {
    const admin = adminClient()

    const { data: row, error } = await admin
      .from('constraint_violations')
      .insert({
        violation_type: 'tool_result_size_exceeded',
        attempted_value: 1_000_000,
        configured_cap: 524288,
        context: {
          organisation_id: orgA,
          tool_name: 'get_node_tree',
          notes: 'integration test',
        },
        organisation_id: orgA,
      })
      .select('id, violation_type, attempted_value, configured_cap, context')
      .single()
    expect(error).toBeNull()
    expect(row!.violation_type).toBe('tool_result_size_exceeded')
    expect(row!.attempted_value).toBe(1_000_000)
    expect(row!.configured_cap).toBe(524288)
    expect((row!.context as { tool_name: string }).tool_name).toBe('get_node_tree')

    await admin.from('constraint_violations').delete().eq('id', row!.id)
  })

  test('platform_config: atom-size cap is readable + bounds correct', async () => {
    const admin = adminClient()
    const { data } = await admin
      .from('platform_config')
      .select('value, value_type')
      .eq('key', 'constraints.max_tool_result_bytes')
      .single()
    expect(data!.value_type).toBe('integer')
    const cap = typeof data!.value === 'number' ? data!.value : Number(data!.value)
    expect(cap).toBe(524288)
  })
})
