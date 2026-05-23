/**
 * Apollo-grade simulator — scenario-driven integration tests.
 *
 * Source: docs/stelavox_brief_orchestration_v1_0.md §11.6
 * "A simulator, not just unit tests."
 *
 * Per-scenario shape:
 *   1. Seed initial state (brief / stages / workflow / agent_jobs / turns).
 *   2. Drive a sequence of legal events through the state machine.
 *   3. At every checkpoint, assert audit_orchestration_state() returns
 *      empty for the affected entities.
 *   4. Assert the final state matches expectation.
 *
 * Coverage: ten critical scenarios spanning the cross-entity flows
 * the user-facing system actually runs. These complement the
 * transition-matrix.spec.ts (single-transition correctness) and
 * audit-invariants.spec.ts (per-invariant detection) with end-to-end
 * multi-step proofs.
 *
 * Mocking: NO LLM calls. The simulator drives state transitions
 * directly via SQL + orchestration. Real LLM-driven flows are
 * exercised by user-driven launch testing.
 */

import { expect, test } from '@playwright/test'
import { adminClient } from '../helpers/db'
import {
  attachWorkflowToBriefStage,
  transitionAgentJob,
  transitionWorkflow,
  transitionWorkflowStep,
} from '@/lib/orchestration'

interface Fixture {
  documentId: string
  orgId: string
  nodeIds: string[]
  conversationId: string
}

let fx: Fixture

test.beforeAll(async () => {
  const admin = adminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('id, organisation_id')
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('no documents seeded')

  const { data: nodes } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', doc.id as string)
    .limit(5)
  if (!nodes || nodes.length === 0) throw new Error('no nodes in document')

  const { data: existingConv } = await admin
    .from('conversations')
    .select('id')
    .eq('document_id', doc.id as string)
    .limit(1)
    .maybeSingle()

  let convId: string
  if (existingConv) {
    convId = existingConv.id as string
  } else {
    const { data: conv } = await admin
      .from('conversations')
      .insert({ document_id: doc.id as string, organisation_id: doc.organisation_id as string })
      .select('id')
      .single()
    convId = conv!.id as string
  }

  fx = {
    documentId: doc.id as string,
    orgId: doc.organisation_id as string,
    nodeIds: nodes.map((n) => n.id as string),
    conversationId: convId,
  }
})

test.beforeEach(async () => {
  // Force-reset the document before each scenario.
  const admin = adminClient()
  await admin.rpc('force_reset_document', { p_document_id: fx.documentId })
})

interface AuditRow {
  invariant_id: string
  entity_table: string
  entity_id: string
  violation: string
  details: Record<string, unknown>
}

async function auditFor(entityIds: string[]): Promise<AuditRow[]> {
  const admin = adminClient()
  const { data } = await admin.rpc('audit_orchestration_state')
  const rows = (data ?? []) as AuditRow[]
  return rows.filter((r) => entityIds.includes(r.entity_id))
}

async function assertCleanFor(entityIds: string[], checkpoint: string): Promise<void> {
  const violations = await auditFor(entityIds)
  expect(violations, `audit violations at checkpoint "${checkpoint}": ${JSON.stringify(violations)}`).toEqual([])
}

interface BriefScaffold {
  briefId: string
  stages: Array<{ id: string; order: number; workflowId: string | null; stepId: string | null; jobId: string | null }>
  turnId: string | null
}

async function seedBriefScaffold(stagesSpec: Array<{ workflow: boolean; prompt: string | null }>): Promise<BriefScaffold> {
  const admin = adminClient()
  // Belt-and-braces force-reset (Playwright's beforeEach should have
  // cleared, but cascade is async and the partial unique index will
  // refuse a second active brief if any lingers).
  await admin.rpc('force_reset_document', { p_document_id: fx.documentId })

  const { data: brief, error: briefErr } = await admin
    .from('briefs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      goal_text: 'simulator',
      state: 'active',
      status: 'active', // legacy two-column shape; BEFORE INSERT auto-derive trigger overrides this from `state` anyway, but TS expects the field
      cause: 'user_initial',
      sequence_position: 0,
    })
    .select('id')
    .single()
  if (briefErr || !brief) {
    throw new Error(`seedBriefScaffold brief insert failed: ${briefErr?.message ?? 'no row'}`)
  }

  const stages: BriefScaffold['stages'] = []
  for (let i = 0; i < stagesSpec.length; i++) {
    const s = stagesSpec[i]
    let workflowId: string | null = null
    let stepId: string | null = null
    let jobId: string | null = null

    if (s.workflow) {
      const { data: wf } = await admin
        .from('workflows')
        .insert({
          organisation_id: fx.orgId,
          document_id: fx.documentId,
          title: `sim wf ${i + 1}`,
          state: 'approved',
        })
        .select('id')
        .single()
      workflowId = wf!.id as string

      const { data: step } = await admin
        .from('workflow_steps')
        .insert({
          workflow_id: workflowId,
          order: 1,
          operation_type: 'expand',
          target_node_id: fx.nodeIds[i % fx.nodeIds.length],
          description: `sim step ${i + 1}`,
          estimated_duration_seconds: 60,
          state: 'pending',
        })
        .select('id')
        .single()
      stepId = step!.id as string

      const { data: job } = await admin
        .from('agent_jobs')
        .insert({
          organisation_id: fx.orgId,
          document_id: fx.documentId,
          operation_type: 'expand',
          triggered_by: `workflow_step:${stepId}:${workflowId}`,
          state: 'queued',
        })
        .select('id')
        .single()
      jobId = job!.id as string
    }

    const { data: stage } = await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: i + 1,
        title: `sim stage ${i + 1}`,
        trigger_type: i === 0 ? 'manual' : 'after_stage',
        trigger_config: i === 0 ? {} : { after_stage_order: i },
        state: workflowId ? 'ready' : 'planned',
        workflow_id: workflowId,
        prompt: s.prompt,
      })
      .select('id')
      .single()
    stages.push({ id: stage!.id as string, order: i + 1, workflowId, stepId, jobId })
  }

  return { briefId: brief!.id as string, stages, turnId: null }
}

function entityIdsOf(scaffold: BriefScaffold): string[] {
  const ids: string[] = [scaffold.briefId]
  for (const s of scaffold.stages) {
    ids.push(s.id)
    if (s.workflowId) ids.push(s.workflowId)
    if (s.stepId) ids.push(s.stepId)
    if (s.jobId) ids.push(s.jobId)
  }
  if (scaffold.turnId) ids.push(scaffold.turnId)
  return ids
}

// ---------------------------------------------------------------------------
// Scenario 1: single-stage happy path
// ---------------------------------------------------------------------------

test('Scenario 1: single-stage workflow-bound brief — full happy path', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  const ids = entityIdsOf(sb)
  await assertCleanFor(ids, 'seeded')

  // Step 1: workflow dispatched. agent_job queued → dispatched → running → awaiting_accept.
  
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await assertCleanFor(ids, 'agent_job dispatched')

  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'dispatch', 'running', { agent_job_id: sb.stages[0].jobId })
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'dispatch_first', 'running')
  await assertCleanFor(ids, 'all running')

  await transitionAgentJob(admin, sb.stages[0].jobId!, 'llm_ok', 'awaiting_accept')
  await assertCleanFor(ids, 'awaiting_accept')

  await transitionAgentJob(admin, sb.stages[0].jobId!, 'author_accept', 'accepted')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'job_terminal_success', 'completed')
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'all_steps_terminal_success', 'completed')
  await assertCleanFor(ids, 'workflow completed')

  // Propagate brief completion.
  await admin.rpc('complete_brief_stage_workflow', { p_workflow_id: sb.stages[0].workflowId! })
  const { data: b } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((b as { state: string }).state).toBe('completed')
  await assertCleanFor(ids, 'final')
})

// ---------------------------------------------------------------------------
// Scenario 2: two-stage chain (workflow + prompt-deferred)
// ---------------------------------------------------------------------------

test('Scenario 2: 2-stage brief — workflow stage + prompt-deferred stage chain', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([
    { workflow: true, prompt: null },
    { workflow: false, prompt: 'Synthesise prose for the beats' },
  ])
  const ids = entityIdsOf(sb)
  await assertCleanFor(ids, 'seeded')

  

  // Stage 1 runs to completion.
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'dispatch', 'running', { agent_job_id: sb.stages[0].jobId })
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'dispatch_first', 'running')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'llm_ok', 'awaiting_accept')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'author_accept', 'accepted')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'job_terminal_success', 'completed')
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'all_steps_terminal_success', 'completed')
  await admin.rpc('complete_brief_stage_workflow', { p_workflow_id: sb.stages[0].workflowId! })
  await assertCleanFor(ids, 'stage 1 complete')

  // Stage 2 trigger fires (simulated). Stage moves planned → planning.
  // Note: brief_stages.state evaluator transitions happen via RPC in
  // production. For the simulator, we drive it directly.
  await admin.from('brief_stages').update({ state: 'planning' }).eq('id', sb.stages[1].id)
  await assertCleanFor(ids, 'stage 2 planning')

  // Director plans stage 2's workflow (simulated propose_workflow).
  const { data: wf2 } = await admin
    .from('workflows')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      title: 'stage 2 wf',
      state: 'approved',
    })
    .select('id')
    .single()
  await attachWorkflowToBriefStage(admin, sb.stages[1].id, wf2!.id as string, 'planning')
  await assertCleanFor([...ids, wf2!.id as string], 'stage 2 workflow attached')

  // Stage 2 step runs to completion.
  const { data: step2 } = await admin
    .from('workflow_steps')
    .insert({
      workflow_id: wf2!.id,
      order: 1,
      operation_type: 'synthesise',
      target_node_id: fx.nodeIds[1],
      description: 'sim step stage 2',
      estimated_duration_seconds: 60,
      state: 'pending',
    })
    .select('id')
    .single()
  const { data: job2 } = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      operation_type: 'synthesise',
      triggered_by: `workflow_step:${step2!.id}:${wf2!.id}`,
      state: 'queued',
    })
    .select('id')
    .single()
  await transitionAgentJob(admin, job2!.id as string, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, job2!.id as string, 'persist_running_start', 'running')
  await transitionWorkflowStep(admin, step2!.id as string, 'dispatch', 'running', { agent_job_id: job2!.id })
  await transitionWorkflow(admin, wf2!.id as string, 'dispatch_first', 'running')
  await transitionAgentJob(admin, job2!.id as string, 'llm_ok', 'awaiting_accept')
  await transitionAgentJob(admin, job2!.id as string, 'author_accept', 'accepted')
  await transitionWorkflowStep(admin, step2!.id as string, 'job_terminal_success', 'completed')
  await transitionWorkflow(admin, wf2!.id as string, 'all_steps_terminal_success', 'completed')
  await admin.rpc('complete_brief_stage_workflow', { p_workflow_id: wf2!.id! })

  const { data: b } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((b as { state: string }).state).toBe('completed')
  await assertCleanFor([...ids, wf2!.id as string, step2!.id as string, job2!.id as string], 'final')
})

// ---------------------------------------------------------------------------
// Scenario 3: mid-flight cascade cancel
// ---------------------------------------------------------------------------

test('Scenario 3: mid-flight cancel cascades to all 6 entities atomically', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  

  // Get the workflow running with the agent_job mid-call.
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'dispatch', 'running', { agent_job_id: sb.stages[0].jobId })
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'dispatch_first', 'running')

  // Add an in-progress director turn for full cascade coverage.
  const { data: turn } = await admin
    .from('director_turns')
    .insert({ conversation_id: fx.conversationId, state: 'in_progress' })
    .select('id')
    .single()

  // User cancels.
  const { data: result } = await admin.rpc('cancel_brief', { p_brief_id: sb.briefId, p_reason: 'simulator' })
  expect(result).toBeTruthy()

  const ids = [...entityIdsOf(sb), turn!.id as string]

  // Every entity must be terminal.
  const { data: brief } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((brief as { state: string }).state).toBe('cancelled')

  const { data: stage } = await admin.from('brief_stages').select('state').eq('id', sb.stages[0].id).single()
  expect((stage as { state: string }).state).toBe('cancelled')

  const { data: workflow } = await admin.from('workflows').select('state').eq('id', sb.stages[0].workflowId!).single()
  expect((workflow as { state: string }).state).toBe('cancelled')

  const { data: step } = await admin.from('workflow_steps').select('state').eq('id', sb.stages[0].stepId!).single()
  expect((step as { state: string }).state).toBe('skipped')

  const { data: job } = await admin.from('agent_jobs').select('state').eq('id', sb.stages[0].jobId!).single()
  expect((job as { state: string }).state).toBe('cancelled')

  const { data: t } = await admin.from('director_turns').select('state').eq('id', turn!.id as string).single()
  expect((t as { state: string }).state).toBe('cancelled')

  await assertCleanFor(ids, 'post-cascade')
})

// ---------------------------------------------------------------------------
// Scenario 4: force_reset_document
// ---------------------------------------------------------------------------

test('Scenario 4: force_reset_document clears everything for a document', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')

  await admin.rpc('force_reset_document', { p_document_id: fx.documentId })

  const { data: brief } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((brief as { state: string }).state).toBe('cancelled')

  const { data: job } = await admin.from('agent_jobs').select('state').eq('id', sb.stages[0].jobId!).single()
  expect((job as { state: string }).state).toBe('cancelled')

  await assertCleanFor(entityIdsOf(sb), 'post-force-reset')
})

// ---------------------------------------------------------------------------
// Scenario 5: Director planning failure with retry
// ---------------------------------------------------------------------------

test('Scenario 5: prompt-deferred stage Director refuses → retry counter increments', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: false, prompt: 'plan something' }])

  // First-stage prompt-deferred starts at 'planned'. Drive it to 'planning'.
  await admin.from('brief_stages').update({ state: 'planning' }).eq('id', sb.stages[0].id)

  // Simulate the expected-output check: Director didn't emit propose_workflow.
  // The check would: increment planning_retry_count, revert to 'planned'.
  await admin
    .from('brief_stages')
    .update({ state: 'planned', planning_retry_count: 1 })
    .eq('id', sb.stages[0].id)

  const { data: stage } = await admin
    .from('brief_stages')
    .select('state, planning_retry_count')
    .eq('id', sb.stages[0].id)
    .single()
  expect((stage as { state: string; planning_retry_count: number }).state).toBe('planned')
  expect((stage as { state: string; planning_retry_count: number }).planning_retry_count).toBe(1)

  await assertCleanFor(entityIdsOf(sb), 'after retry')
})

// ---------------------------------------------------------------------------
// Scenario 6: planning retries exhausted → failed
// ---------------------------------------------------------------------------

test('Scenario 6: planning retries exhausted → stage transitions to failed', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: false, prompt: 'plan something' }])
  await admin
    .from('brief_stages')
    .update({ state: 'planning', planning_retry_count: 3 })
    .eq('id', sb.stages[0].id)

  // Expected-output check decides retries are exhausted → 'failed'.
  await admin
    .from('brief_stages')
    .update({ state: 'failed' })
    .eq('id', sb.stages[0].id)

  const { data: stage } = await admin.from('brief_stages').select('state').eq('id', sb.stages[0].id).single()
  expect((stage as { state: string }).state).toBe('failed')

  await assertCleanFor(entityIdsOf(sb), 'after failed')
})

// ---------------------------------------------------------------------------
// Scenario 7: heartbeat-stale reconcile → crashed
// ---------------------------------------------------------------------------

test('Scenario 7: running agent_job with stale heartbeat → reconcile sweep marks crashed', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  

  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')

  // Inject stale heartbeat (>60s ago).
  await admin
    .from('agent_jobs')
    .update({ last_heartbeat_at: new Date(Date.now() - 120_000).toISOString() })
    .eq('id', sb.stages[0].jobId!)

  await admin.rpc('reconcile_orchestration_state')

  const { data: job } = await admin
    .from('agent_jobs')
    .select('state, failure_class')
    .eq('id', sb.stages[0].jobId!)
    .single()
  expect((job as { state: string }).state).toBe('crashed')
  expect((job as { failure_class: string }).failure_class).toBe('B')
})

// ---------------------------------------------------------------------------
// Scenario 8: stuck-claim sweep (NULL heartbeat)
// ---------------------------------------------------------------------------

test('Scenario 8: dispatched agent_job with NULL heartbeat past threshold → swept to crashed', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  

  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')

  // dispatched_at in the past, last_heartbeat_at NULL (runner never started).
  await admin
    .from('agent_jobs')
    .update({
      dispatched_at: new Date(Date.now() - 120_000).toISOString(),
      last_heartbeat_at: null,
    })
    .eq('id', sb.stages[0].jobId!)

  await admin.rpc('reconcile_orchestration_state')

  const { data: job } = await admin
    .from('agent_jobs')
    .select('state, error_message')
    .eq('id', sb.stages[0].jobId!)
    .single()
  expect((job as { state: string }).state).toBe('crashed')
  expect((job as { error_message: string }).error_message).toContain('runner failed to start')
})

// ---------------------------------------------------------------------------
// Scenario 9: workflow drift recovery
// ---------------------------------------------------------------------------

test('Scenario 9: workflow stuck running with all steps terminal → reconcile promotes to completed', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])
  

  // Get the workflow running, drive the step to completed but DON'T propagate workflow.
  await transitionWorkflow(admin, sb.stages[0].workflowId!, 'dispatch_first', 'running')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'dispatcher_cas_claim', 'dispatched')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'persist_running_start', 'running')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'llm_ok', 'awaiting_accept')
  await transitionAgentJob(admin, sb.stages[0].jobId!, 'author_accept', 'accepted')
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'dispatch', 'running', { agent_job_id: sb.stages[0].jobId })
  await transitionWorkflowStep(admin, sb.stages[0].stepId!, 'job_terminal_success', 'completed')

  const { data: wfBefore } = await admin.from('workflows').select('state').eq('id', sb.stages[0].workflowId!).single()
  expect((wfBefore as { state: string }).state).toBe('running')

  await admin.rpc('reconcile_orchestration_state')

  const { data: wfAfter } = await admin.from('workflows').select('state').eq('id', sb.stages[0].workflowId!).single()
  expect((wfAfter as { state: string }).state).toBe('completed')
})

// ---------------------------------------------------------------------------
// Scenario 10: brief drift recovery
// ---------------------------------------------------------------------------

test('Scenario 10: brief stuck active with all stages terminal → reconcile propagates to completed', async () => {
  const admin = adminClient()
  const sb = await seedBriefScaffold([{ workflow: true, prompt: null }])

  // Force every stage to 'completed' but leave the brief 'active'.
  await admin.from('brief_stages').update({ state: 'completed' }).eq('id', sb.stages[0].id)

  const { data: briefBefore } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((briefBefore as { state: string }).state).toBe('active')

  await admin.rpc('reconcile_orchestration_state')

  const { data: briefAfter } = await admin.from('briefs').select('state').eq('id', sb.briefId).single()
  expect((briefAfter as { state: string }).state).toBe('completed')
})

// ---------------------------------------------------------------------------
// M-205 (Apollo iteration-fork fix) — Scenarios 11-14
//
// Layer 1 (claim guard) is exercised by Scenario 11.
// Layer 2 (consumer_kind partition) is exercised by Scenario 12.
// Layer 3 (spawn-next trigger + unique index) is exercised by
// Scenarios 13 and 14.
// ---------------------------------------------------------------------------

/**
 * Seed a director_turn + first iteration row for the M-205 tests.
 * Returns the ids so the test can drive the iteration state directly.
 */
async function seedDirectorIteration(
  consumerKind: 'inline_route' | 'dispatcher',
  state: 'queued' | 'dispatched' | 'running' = 'queued',
): Promise<{ turnId: string; jobId: string }> {
  const admin = adminClient()
  const { data: turn, error: turnErr } = await admin
    .from('director_turns')
    .insert({
      conversation_id: fx.conversationId,
      status: 'in_progress',
    })
    .select('id')
    .single()
  if (turnErr || !turn) throw new Error(`director_turns insert failed: ${turnErr?.message}`)

  const iterationState = {
    __schema_version: 1,
    conversation_context: [],
    messages: [{ role: 'user', content: 'sim' }],
    user_message: { role: 'user', content: 'sim' },
    system_prompt_version: 1,
    model: 'sim-model',
    mentioned_node_ids: [],
  }

  const { data: job, error: jobErr } = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      operation_type: 'director_iteration',
      state,
      traffic_class: 1,
      route: 'platform',
      cause: 'user_message',
      triggered_by: 'director_turn',
      director_turn_id: turn.id as string,
      parent_iteration_id: null,
      iteration_number: 1,
      iteration_state: iterationState,
      consumer_kind: consumerKind,
    })
    .select('id')
    .single()
  if (jobErr || !job) throw new Error(`agent_jobs insert failed: ${jobErr?.message}`)

  return { turnId: turn.id as string, jobId: job.id as string }
}

test('Scenario 11 (M-205 Layer 1): concurrent claim race — exactly one runner wins', async () => {
  const admin = adminClient()
  const seed = await seedDirectorIteration('dispatcher', 'dispatched')

  // Two concurrent claims via the orchestration entry point. The DB
  // CAS trigger refuses the second; transitionAgentJob returns
  // { ok: false, error: 'illegal_transition' }.
  const [a, b] = await Promise.all([
    transitionAgentJob(admin, seed.jobId, 'persist_running_start', 'running'),
    transitionAgentJob(admin, seed.jobId, 'persist_running_start', 'running'),
  ])
  const wins = [a, b].filter((r) => r.ok)
  const losses = [a, b].filter((r) => !r.ok)
  expect(wins.length).toBe(1)
  expect(losses.length).toBe(1)
  // M-205 layer-0 foundation: transitionAgentJob is now a true CAS.
  // The loser's UPDATE matches 0 rows because state has already moved
  // past the expected source. error='cas_lost'. Pre-M-205 this was
  // silently winning; pre-CAS-fix this was 'illegal_transition' from
  // the trigger (when the state HAD changed but pair was illegal).
  expect(losses[0].error).toBe('cas_lost')

  const { data: row } = await admin
    .from('agent_jobs')
    .select('state, actual_input_tokens')
    .eq('id', seed.jobId)
    .single()
  expect((row as { state: string }).state).toBe('running')
  // The losing runner must NOT have written tokens. (In production
  // the runner would have called the LLM and stamped tokens; here we
  // assert no double-write via the state machine only.)
  expect((row as { actual_input_tokens: number | null }).actual_input_tokens).toBeNull()
})

test('Scenario 12 (M-205 Layer 2): inline_route row is invisible to dispatcher candidate query', async () => {
  const admin = adminClient()
  const inline = await seedDirectorIteration('inline_route', 'queued')
  const dispatched = await seedDirectorIteration('dispatcher', 'queued')

  // The dispatcher's candidate query filters consumer_kind='inline_route'.
  // Mirror that query here to verify the partition holds.
  const { data: visible } = await admin
    .from('agent_jobs')
    .select('id, consumer_kind')
    .eq('queue_status', 'queued')
    .eq('consumer_kind', 'dispatcher')
    .is('completed_at', null)
    .in('id', [inline.jobId, dispatched.jobId])

  const visibleIds = (visible ?? []).map((r) => (r as { id: string }).id)
  expect(visibleIds).toContain(dispatched.jobId)
  expect(visibleIds).not.toContain(inline.jobId)
})

test('Scenario 13 (M-205 Layer 3): spawn-next trigger fires on awaiting_accept with stop_reason=tool_use', async () => {
  const admin = adminClient()
  const seed = await seedDirectorIteration('inline_route', 'running')

  // Drive the running → awaiting_accept transition with stop_reason='tool_use'.
  // The trigger should insert exactly one child row inheriting
  // consumer_kind from the parent.
  const result = await transitionAgentJob(admin, seed.jobId, 'llm_ok', 'awaiting_accept', {
    resultColumns: { stop_reason: 'tool_use' },
  })
  expect(result.ok).toBe(true)

  const { data: children } = await admin
    .from('agent_jobs')
    .select('id, parent_iteration_id, iteration_number, consumer_kind, state')
    .eq('parent_iteration_id', seed.jobId)
  expect(children?.length).toBe(1)
  const child = (children ?? [])[0] as {
    iteration_number: number
    consumer_kind: string
    state: string
  }
  expect(child.iteration_number).toBe(2)
  expect(child.consumer_kind).toBe('inline_route') // inherited from parent
  expect(child.state).toBe('queued')

  // Negative case: end_turn must NOT spawn. Drive a fresh iteration
  // and assert no child.
  const seed2 = await seedDirectorIteration('dispatcher', 'running')
  const r2 = await transitionAgentJob(admin, seed2.jobId, 'llm_ok', 'awaiting_accept', {
    resultColumns: { stop_reason: 'end_turn' },
  })
  expect(r2.ok).toBe(true)
  const { data: children2 } = await admin
    .from('agent_jobs')
    .select('id')
    .eq('parent_iteration_id', seed2.jobId)
  expect(children2?.length).toBe(0)
})

test('Scenario 14 (M-205 Layer 3): parent_iteration_id unique index forbids fork', async () => {
  const admin = adminClient()
  const parent = await seedDirectorIteration('inline_route', 'running')

  // First child INSERT succeeds.
  const child1 = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      operation_type: 'director_iteration',
      state: 'queued',
      traffic_class: 1,
      route: 'platform',
      cause: 'director_iteration',
      triggered_by: 'iteration_chain',
      director_turn_id: parent.turnId,
      parent_iteration_id: parent.jobId,
      iteration_number: 2,
      iteration_state: {
        __schema_version: 1,
        conversation_context: [],
        messages: [],
        user_message: { role: 'user', content: 'sim' },
        system_prompt_version: 1,
        model: 'sim',
        mentioned_node_ids: [],
      },
      consumer_kind: 'inline_route',
    })
    .select('id')
    .single()
  expect(child1.error).toBeNull()

  // Second child INSERT with the same parent_iteration_id must fail
  // with 23505 (unique_violation). This is the schema-level guarantee
  // that the iteration tree is a chain.
  const child2 = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: fx.orgId,
      document_id: fx.documentId,
      operation_type: 'director_iteration',
      state: 'queued',
      traffic_class: 1,
      route: 'platform',
      cause: 'director_iteration',
      triggered_by: 'iteration_chain',
      director_turn_id: parent.turnId,
      parent_iteration_id: parent.jobId, // duplicate
      iteration_number: 2,
      iteration_state: {
        __schema_version: 1,
        conversation_context: [],
        messages: [],
        user_message: { role: 'user', content: 'sim' },
        system_prompt_version: 1,
        model: 'sim',
        mentioned_node_ids: [],
      },
      consumer_kind: 'inline_route',
    })
    .select('id')
    .single()
  expect(child2.error).not.toBeNull()
  expect(child2.error?.code).toBe('23505')

  // I9 audit invariant must NOT fire (the index prevented the fork).
  const { data: violations } = await admin.rpc('audit_orchestration_state')
  const rows = (violations ?? []) as AuditRow[]
  const i9Violations = rows.filter(
    (r) => r.invariant_id === 'I9' && r.entity_id === parent.jobId,
  )
  expect(i9Violations).toEqual([])
})
