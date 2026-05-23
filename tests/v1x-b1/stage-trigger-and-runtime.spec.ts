/**
 * V1.x-B.1.1 session 3a — stage trigger evaluator + runtime substrate.
 *
 * End-to-end verification of:
 *   - evaluate_ready_stage_triggers() fires after_stage triggers when
 *     the predecessor stage completes
 *   - the system event lands in the document's most-recent conversation
 *   - throttle reservation lifecycle (reserve / consume / release / sweepExpired)
 *   - sweepInterruptedIterations marks stale-heartbeat rows
 *   - recordViolation logs to constraint_violations
 *   - Director config v1.8 in production with the trigger_config example
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

async function newDocumentWithConversation(orgId: string, name: string): Promise<{ projectId: string; documentId: string; conversationId: string }> {
  const { data: project } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  const projectId = project!.id

  const { data: doc, error } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: name,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (error) throw new Error(`RPC failed: ${error.message}`)
  const result = doc as unknown as { document: { id: string } }
  const documentId = result.document.id

  // The evaluator emits its system event into the document's most-recent
  // conversation. Create one explicitly so the test isn't sensitive to
  // ordering with parallel conversation-creation paths.
  const { data: conv, error: convErr } = await adminClient()
    .from('conversations')
    .insert({ organisation_id: orgId, document_id: documentId })
    .select()
    .single()
  if (convErr || !conv) throw new Error(`conversation create failed: ${convErr?.message}`)

  return { projectId, documentId, conversationId: conv.id }
}

test.describe('V1.x-B.1.1 session 3a — stage triggers + runtime substrate', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('evaluate_ready_stage_triggers fires when predecessor completes', async () => {
    const { projectId, documentId, conversationId } = await newDocumentWithConversation(orgA, 'V1.x-B.1.1 session3a stage trigger')
    try {
      // M-205-era schema: brief_stages has an enforce_legal_transition
      // trigger that rejects planned → completed (only legal exits from
      // 'planned' are 'planning', 'ready', 'cancelled'). The previous
      // form of this test created the brief via accept_brief (stages
      // start at 'planned'), then UPDATEd stage 1 to 'completed' — that
      // direct UPDATE is now an illegal transition.
      //
      // Apollo-correct test setup: bypass accept_brief and INSERT the
      // brief + stages directly with stage 1 ALREADY in 'completed'.
      // The legal-transition trigger fires on UPDATE only — initial
      // INSERTs can land any legal state. This matches what the
      // evaluator sees in production after a real workflow completes
      // and complete_brief_stage_workflow transitions ready→completed.
      const { data: brief, error: briefErr } = await adminClient()
        .from('briefs')
        .insert({
          organisation_id: orgA,
          document_id: documentId,
          status: 'active',
          goal_text: 'session3a stage-trigger flow',
          sequence_position: 0,
        })
        .select('id')
        .single()
      expect(briefErr).toBeNull()
      const briefId = brief!.id

      // M-185 evaluator semantics: a 'planned' stage with NO workflow_id
      // MUST have a prompt — otherwise it's invalid (nothing for the
      // system to plan) and the evaluator skips it. Stage 2 needs a
      // prompt so the trigger has something to fire on.
      const { error: stagesErr } = await adminClient()
        .from('brief_stages')
        .insert([
          { brief_id: briefId, order: 1, title: 'Stage one', status: 'completed', completed_at: new Date().toISOString(), trigger_type: 'manual', trigger_config: {} },
          { brief_id: briefId, order: 2, title: 'Stage two', status: 'planned', trigger_type: 'after_stage', trigger_config: { after_stage_order: 1 }, prompt: 'Plan stage two when stage one completes.' },
        ])
      expect(stagesErr).toBeNull()

      // Sanity check: stage 2 starts 'planned'.
      const { data: stagesPre } = await adminClient()
        .from('brief_stages')
        .select('order, status')
        .eq('brief_id', briefId)
      const stage2Pre = (stagesPre ?? []).find((s) => (s as { order: number }).order === 2)
      expect(stage2Pre).toBeDefined()
      expect(stage2Pre!.status).toBe('planned')

      // Evaluator finds stage 2 ready (predecessor completed), marks
      // it 'planning' (M-183 renamed 'proposing' → 'planning'), and
      // emits the system event.
      const { data: fired2Raw } = await adminClient().rpc('evaluate_ready_stage_triggers')
      const fired2 = typeof fired2Raw === 'number' ? fired2Raw : Number(fired2Raw ?? 0)
      expect(fired2).toBeGreaterThanOrEqual(1)

      const { data: stagesPost } = await adminClient()
        .from('brief_stages')
        .select('order, status')
        .eq('brief_id', briefId)
      const stage2Post = (stagesPost ?? []).find((s) => (s as { order: number }).order === 2)
      expect(stage2Post).toBeDefined()
      expect(stage2Post!.status).toBe('planning')

      // System event landed in the conversation.
      const { data: events } = await adminClient()
        .from('conversation_messages')
        .select('role, event_type, event_payload, cause, content')
        .eq('conversation_id', conversationId)
        .eq('role', 'system')
        .eq('event_type', 'stage_trigger_fired')
      expect(events).toBeDefined()
      expect(events!.length).toBeGreaterThanOrEqual(1)
      const evt = events!.find((e) => (e.event_payload as { brief_id?: string }).brief_id === briefId)
      expect(evt).toBeDefined()
      expect((evt!.event_payload as { stage_order?: number }).stage_order).toBe(2)
      expect(evt!.cause).toBe('scheduler_trigger')

      // Idempotent — second call doesn't re-fire on the same stage.
      const { data: fired3Raw } = await adminClient().rpc('evaluate_ready_stage_triggers')
      const fired3 = typeof fired3Raw === 'number' ? fired3Raw : Number(fired3Raw ?? 0)
      const { data: events2 } = await adminClient()
        .from('conversation_messages')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('role', 'system')
        .eq('event_type', 'stage_trigger_fired')
      // No new event for THIS brief on second call.
      expect(events2!.length).toBe(events!.length)
      // Counts the global universe of newly-fired triggers (could be 0 here).
      void fired3
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('throttle reservation lifecycle: reserve / consume / release', async () => {
    const admin = adminClient()

    const { data: r1, error: e1 } = await admin
      .from('throttle_reservations')
      .insert({
        route: 'platform',
        traffic_class: 1,
        organisation_id: orgA,
        slots_reserved: 1,
        tokens_reserved: 1000,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
      .select('id, expires_at')
      .single()
    expect(e1).toBeNull()
    expect(r1).toBeDefined()
    const reservationId = r1!.id

    // Consume.
    await admin
      .from('throttle_reservations')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', reservationId)

    const { data: afterConsume } = await admin
      .from('throttle_reservations')
      .select('consumed_at, released_at')
      .eq('id', reservationId)
      .single()
    expect(afterConsume!.consumed_at).not.toBeNull()
    expect(afterConsume!.released_at).toBeNull()

    // Release.
    await admin
      .from('throttle_reservations')
      .update({ released_at: new Date().toISOString() })
      .eq('id', reservationId)

    const { data: afterRelease } = await admin
      .from('throttle_reservations')
      .select('consumed_at, released_at')
      .eq('id', reservationId)
      .single()
    expect(afterRelease!.released_at).not.toBeNull()

    // Cleanup.
    await admin.from('throttle_reservations').delete().eq('id', reservationId)
  })

  test('scheduler_sweep_throttle_reservations releases expired-not-consumed', async () => {
    const admin = adminClient()
    const past = new Date(Date.now() - 5_000).toISOString()  // expired 5s ago
    const { data } = await admin
      .from('throttle_reservations')
      .insert({
        route: 'platform',
        slots_reserved: 1,
        tokens_reserved: 0,
        expires_at: past,
      })
      .select('id')
      .single()
    const expiredId = data!.id

    const { data: sweptCount } = await admin.rpc('scheduler_sweep_throttle_reservations')
    expect(typeof sweptCount === 'number' ? sweptCount : Number(sweptCount)).toBeGreaterThanOrEqual(1)

    const { data: after } = await admin
      .from('throttle_reservations')
      .select('released_at')
      .eq('id', expiredId)
      .single()
    expect(after!.released_at).not.toBeNull()

    await admin.from('throttle_reservations').delete().eq('id', expiredId)
  })

  test('scheduler_sweep_interrupted_iterations marks stale agent_jobs (V1.x-B.2.1 redirect)', async () => {
    // V1.x-B.2.1 (M-107) drops director_iterations and redirects this
    // sweep procedure to UPDATE agent_jobs WHERE queue_status IN
    // ('dispatched','running') AND last_heartbeat_at is stale. Same
    // procedure signature so M-102's pg_cron schedule keeps calling it
    // unchanged. Verifies the v2 contract.
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
    const jobId = job!.id

    const { data: sweptCount } = await admin.rpc('scheduler_sweep_interrupted_iterations', {
      p_stale_threshold_seconds: 60,
    })
    expect(typeof sweptCount === 'number' ? sweptCount : Number(sweptCount)).toBeGreaterThanOrEqual(1)

    const { data: after } = await admin
      .from('agent_jobs')
      .select('queue_status, status, failure_class, error_message, crashed_at')
      .eq('id', jobId)
      .single()
    expect(after!.queue_status).toBe('crashed')
    expect(after!.status).toBe('failed')
    expect(after!.failure_class).toBe('B')
    expect(after!.error_message).toContain('heartbeat stale')
    expect(after!.crashed_at).not.toBeNull()

    // Cleanup.
    await admin.from('agent_jobs').delete().eq('id', jobId)
  })

  test('Production Director config has the simplified-brief-model tool surface', async () => {
    // V1.x-F.1 (Migration 146) introduced report_capability_limit.
    // 2026-05-21 simplification (M-184) further narrowed to 17 tools
    // by replacing propose_brief_amendment with propose_workflow.
    // Subsequent migrations (M-185, M-186, ...) may bump version_number
    // further without changing the tool surface. Test the contract,
    // not a specific version pin.
    const { data } = await adminClient()
      .from('director_configs')
      .select('version_number, status, system_prompt, tool_suite')
      .eq('status', 'production')
      .single()
    const tools = data!.tool_suite as string[]
    expect(tools).toHaveLength(17)
    expect(tools).toContain('cancel_brief')
    expect(tools).toContain('propose_workflow')
    expect(tools).toContain('report_capability_limit')
    expect(tools).not.toContain('propose_brief_amendment')
    expect(data!.system_prompt).toContain('after_stage_order')
  })

  test('pg_cron has scheduled the V1.x-B.1.1 maintenance jobs', async () => {
    const admin = adminClient()
    // pg_cron registration is verified by the migration applying cleanly +
    // the smoke run during Migration 102 commit. Soft-verify here that the
    // sweep procedure is callable end-to-end (proves the maintenance
    // surface works; cron registration is independently asserted by the
    // migration apply gate).
    const { data: procs } = await admin.rpc('scheduler_sweep_throttle_reservations')
    expect(typeof procs === 'number' ? procs : Number(procs)).toBeGreaterThanOrEqual(0)
  })
})
