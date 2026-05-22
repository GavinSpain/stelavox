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
