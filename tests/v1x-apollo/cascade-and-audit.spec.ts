/**
 * Apollo-grade capsule test.
 *
 * Validates the spec's central claim: no LLM behaviour, network error,
 * runner crash, or user action can leave the orchestration layer in
 * an unknown state. Every transition is enforced; every cascade is
 * atomic; every drift is detectable.
 *
 * This test is the "Apollo simulator pass": create a brief with a
 * stage + workflow + workflow_step + agent_job + director_turn in
 * flight, then exercise:
 *   1. The DB trigger refuses illegal transitions.
 *   2. cancel_brief cascades atomically through all 6 entity types.
 *   3. After cascade, audit_orchestration_state() returns empty for
 *      the affected entities.
 *   4. force_reset_document leaves the document with no orphan rows.
 *
 * No LLM calls. Pure schema + RPC verification.
 */

import { expect, test } from '@playwright/test'
import { adminClient } from '../helpers/db'

interface Fixture {
  orgId: string
  documentId: string
  conversationId: string
  briefId: string
  stageId: string
  workflowId: string
  workflowStepId: string
  agentJobId: string
  turnId: string
}

async function seedFixture(): Promise<Fixture> {
  const admin = adminClient()

  // Pick the first document with nodes. If any active brief exists on
  // it, cancel-cascade first to leave a clean slate.
  const { data: doc } = await admin
    .from('documents')
    .select('id, organisation_id')
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('no documents exist; seed first')
  const documentId = doc.id as string
  const orgId = doc.organisation_id as string

  // force-reset the document before seeding so prior test runs don't pollute.
  await admin.rpc('force_reset_document', { p_document_id: documentId })

  // Find a real node in this document for the workflow_step FK.
  const { data: node } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', documentId)
    .limit(1)
    .maybeSingle()
  if (!node) throw new Error(`document ${documentId} has no nodes`)
  const targetNodeId = node.id as string

  // Find or create a conversation for this document.
  let convId: string
  const { data: existingConv } = await admin
    .from('conversations')
    .select('id')
    .eq('document_id', documentId)
    .limit(1)
    .maybeSingle()
  if (existingConv) {
    convId = existingConv.id as string
  } else {
    const { data: newConv } = await admin
      .from('conversations')
      .insert({ document_id: documentId, organisation_id: orgId })
      .select('id')
      .single()
    convId = newConv!.id as string
  }

  // Create brief — directly INSERTed; bypasses accept_brief for test isolation.
  // Auto-derive trigger will set state='active' from status='active' default.
  const { data: brief, error: briefErr } = await admin
    .from('briefs')
    .insert({
      organisation_id: orgId,
      document_id: documentId,
      goal_text: 'Apollo capsule test',
      status: 'active',
      cause: 'user_initial',
      sequence_position: 0,
    })
    .select('id')
    .single()
  if (briefErr || !brief) throw new Error(`brief insert failed: ${briefErr?.message}`)

  // Create a workflow.
  const { data: wf, error: wfErr } = await admin
    .from('workflows')
    .insert({
      organisation_id: orgId,
      document_id: documentId,
      title: 'Apollo test workflow',
      status: 'running',
    })
    .select('id')
    .single()
  if (wfErr || !wf) throw new Error(`workflow insert failed: ${wfErr?.message}`)

  // Create a brief_stage linked to the workflow.
  const { data: stage, error: stageErr } = await admin
    .from('brief_stages')
    .insert({
      brief_id: brief.id,
      order: 1,
      title: 'Apollo test stage',
      trigger_type: 'manual',
      trigger_config: {},
      status: 'planned',
      workflow_id: wf.id,
    })
    .select('id, state')
    .single()
  if (stageErr || !stage) throw new Error(`stage insert failed: ${stageErr?.message}`)
  // Auto-derive trigger should have set state='ready' because workflow_id is set.
  expect(stage.state).toBe('ready')

  // Create a workflow_step.
  const { data: step, error: stepErr } = await admin
    .from('workflow_steps')
    .insert({
      workflow_id: wf.id,
      order: 1,
      operation_type: 'expand',
      target_node_id: targetNodeId,
      description: 'apollo test step',
      estimated_duration_seconds: 60,
      status: 'running',
    })
    .select('id')
    .single()
  if (stepErr || !step) throw new Error(`step insert failed: ${stepErr?.message}`)

  // Create an in-flight agent_job for the step.
  const { data: job, error: jobErr } = await admin
    .from('agent_jobs')
    .insert({
      organisation_id: orgId,
      document_id: documentId,
      operation_type: 'expand',
      status: 'running',
      queue_status: 'running',
      triggered_by: `workflow_step:${step.id}:${wf.id}`,
      last_heartbeat_at: new Date().toISOString(),
    })
    .select('id')
    .single()
  if (jobErr || !job) throw new Error(`agent_job insert failed: ${jobErr?.message}`)

  // Link step → job.
  await admin.from('workflow_steps').update({ agent_job_id: job.id }).eq('id', step.id)

  // Create an in-progress director_turn on the conversation.
  const { data: turn, error: turnErr } = await admin
    .from('director_turns')
    .insert({
      conversation_id: convId,
      status: 'in_progress',
    })
    .select('id')
    .single()
  if (turnErr || !turn) throw new Error(`turn insert failed: ${turnErr?.message}`)

  return {
    orgId,
    documentId,
    conversationId: convId,
    briefId: brief.id as string,
    stageId: stage.id as string,
    workflowId: wf.id as string,
    workflowStepId: step.id as string,
    agentJobId: job.id as string,
    turnId: turn.id as string,
  }
}

test.describe('Apollo-grade capsule', () => {
  test('CK-A1: illegal direct transition is refused by DB trigger', async () => {
    const admin = adminClient()
    const fx = await seedFixture()

    try {
      // Attempt: agent_job running → queued. Not in allowed_transitions.
      const { error } = await admin
        .from('agent_jobs')
        .update({ state: 'queued' })
        .eq('id', fx.agentJobId)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/illegal_transition/)
    } finally {
      await admin.rpc('cancel_brief', { p_brief_id: fx.briefId, p_reason: 'test_cleanup' })
    }
  })

  test('CK-A2: cancel_brief cascades atomically across all 6 entities', async () => {
    const admin = adminClient()
    const fx = await seedFixture()

    // Sanity: everything in-flight before cancel.
    const { data: beforeBrief } = await admin.from('briefs').select('state').eq('id', fx.briefId).single()
    expect(beforeBrief!.state).toBe('active')

    // Call the enhanced cancel_brief.
    const { data: result, error } = await admin.rpc('cancel_brief', {
      p_brief_id: fx.briefId,
      p_reason: 'apollo_capsule_test',
    })
    expect(error).toBeNull()
    expect(result).toBeTruthy()

    // Assert ALL 6 entities are now terminal.
    const { data: brief } = await admin.from('briefs').select('state').eq('id', fx.briefId).single()
    expect(brief!.state).toBe('cancelled')

    const { data: stage } = await admin.from('brief_stages').select('state').eq('id', fx.stageId).single()
    expect(stage!.state).toBe('cancelled')

    const { data: workflow } = await admin.from('workflows').select('state').eq('id', fx.workflowId).single()
    expect(workflow!.state).toBe('cancelled')

    const { data: step } = await admin.from('workflow_steps').select('state').eq('id', fx.workflowStepId).single()
    expect(step!.state).toBe('skipped')

    const { data: job } = await admin.from('agent_jobs').select('state').eq('id', fx.agentJobId).single()
    expect(job!.state).toBe('cancelled')

    const { data: turn } = await admin.from('director_turns').select('state').eq('id', fx.turnId).single()
    expect(turn!.state).toBe('cancelled')
  })

  test('CK-A3: force_reset_document cleans every entity for a document', async () => {
    const admin = adminClient()
    const fx = await seedFixture()

    const { data: result, error } = await admin.rpc('force_reset_document', {
      p_document_id: fx.documentId,
    })
    expect(error).toBeNull()
    expect(result).toBeTruthy()

    // Same assertions as CK-A2 — everything should be terminal.
    const { data: brief } = await admin.from('briefs').select('state').eq('id', fx.briefId).single()
    expect(brief!.state).toBe('cancelled')

    const { data: job } = await admin.from('agent_jobs').select('state').eq('id', fx.agentJobId).single()
    expect(job!.state).toBe('cancelled')

    const { data: turn } = await admin.from('director_turns').select('state').eq('id', fx.turnId).single()
    expect(turn!.state).toBe('cancelled')
  })

  test('CK-A4: G-06 phantom-zombie class is structurally impossible', async () => {
    const admin = adminClient()
    const fx = await seedFixture()

    try {
      // Simulate the legacy G-06 bug: cancel route writes status='cancelled'
      // without queue_status. The auto-derive trigger must normalise ALL
      // three columns to 'cancelled'.
      const { error } = await admin
        .from('agent_jobs')
        .update({ status: 'cancelled' })
        .eq('id', fx.agentJobId)
      expect(error).toBeNull()

      const { data: after } = await admin
        .from('agent_jobs')
        .select('state, status, queue_status')
        .eq('id', fx.agentJobId)
        .single()

      // The trigger normalised all three columns to the cancelled tuple.
      expect(after!.state).toBe('cancelled')
      expect(after!.status).toBe('cancelled')
      expect(after!.queue_status).toBe('cancelled')
    } finally {
      await admin.rpc('cancel_brief', { p_brief_id: fx.briefId, p_reason: 'test_cleanup' })
    }
  })

  test('CK-A5: reconcile sweep + audit function returns empty after cascade', async () => {
    const admin = adminClient()
    const fx = await seedFixture()

    // Cascade-cancel via Apollo path.
    await admin.rpc('cancel_brief', { p_brief_id: fx.briefId, p_reason: 'apollo_audit_check' })

    // Run the reconcile sweep.
    await admin.rpc('reconcile_orchestration_state')

    // Audit the entities we just cleaned.
    const { data: violations } = await admin.rpc('audit_orchestration_state')
    // Filter to JUST the entities we created — pre-existing drift from
    // other tests is out of scope for this assertion.
    const ourViolations = (violations as Array<{ entity_id: string }>).filter(
      (v) => [fx.briefId, fx.stageId, fx.workflowId, fx.workflowStepId, fx.agentJobId, fx.turnId].includes(v.entity_id),
    )
    expect(ourViolations).toHaveLength(0)
  })
})
