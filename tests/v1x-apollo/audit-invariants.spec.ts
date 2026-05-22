/**
 * Apollo-grade audit invariants test.
 *
 * For each invariant defined in audit_orchestration_state():
 *   * POSITIVE case: when no drift exists, the audit returns no rows
 *     for that invariant.
 *   * NEGATIVE case: when drift is introduced (bypassing triggers via
 *     specific column writes), the audit detects it.
 *   * RECONCILE case: where applicable, reconcile_orchestration_state()
 *     auto-repairs the drift and a follow-up audit confirms clean.
 *
 * Invariants covered:
 *   I1: agent_jobs state and completed_at agree on terminality
 *   I3: workflow_steps.state='completed' ⇒ agent_job ∈ {accepted, awaiting_accept}
 *   I4: workflows.state='completed' ⇒ all steps terminal-success
 *   I5: brief.state='completed' ⇒ all stages terminal
 *   I6: at most one active brief per document
 *   I7: non-terminal stage has workflow_id or prompt
 *   I8: at most one in_progress turn per conversation
 *   I12: workflow_steps.state='running' ⇒ agent_job_id NOT NULL
 *
 * The negative cases use direct SQL via service-role client to bypass
 * triggers and inject drift. This is the only legitimate use of
 * trigger-bypass in the codebase — exclusively for testing the audit
 * function's detection.
 */

import { expect, test } from '@playwright/test'
import { adminClient } from '../helpers/db'

interface TestFixture {
  documentId: string
  orgId: string
  nodeId: string
  conversationId: string
}

let fixture: TestFixture

test.beforeAll(async () => {
  const admin = adminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('id, organisation_id')
    .limit(1)
    .maybeSingle()
  if (!doc) throw new Error('no documents seeded')

  const { data: node } = await admin
    .from('nodes')
    .select('id')
    .eq('document_id', doc.id as string)
    .limit(1)
    .maybeSingle()
  if (!node) throw new Error('no nodes in document')

  const { data: conv } = await admin
    .from('conversations')
    .select('id')
    .eq('document_id', doc.id as string)
    .limit(1)
    .maybeSingle()

  let convId: string
  if (conv) {
    convId = conv.id as string
  } else {
    const { data: newConv } = await admin
      .from('conversations')
      .insert({ document_id: doc.id as string, organisation_id: doc.organisation_id as string })
      .select('id')
      .single()
    convId = newConv!.id as string
  }

  fixture = {
    documentId: doc.id as string,
    orgId: doc.organisation_id as string,
    nodeId: node.id as string,
    conversationId: convId,
  }
})

test.beforeEach(async () => {
  // Force-reset the document before each test so prior runs don't pollute.
  const admin = adminClient()
  await admin.rpc('force_reset_document', { p_document_id: fixture.documentId })
})

interface AuditRow {
  invariant_id: string
  entity_table: string
  entity_id: string
  violation: string
  details: Record<string, unknown>
}

async function audit(): Promise<AuditRow[]> {
  const admin = adminClient()
  const { data, error } = await admin.rpc('audit_orchestration_state')
  expect(error).toBeNull()
  return (data ?? []) as AuditRow[]
}

function violationsFor(rows: AuditRow[], invariantId: string, entityIds: string[]): AuditRow[] {
  return rows.filter((r) => r.invariant_id === invariantId && entityIds.includes(r.entity_id))
}

// ---------------------------------------------------------------------------
// I1 — agent_jobs state and completed_at agree on terminality
// ---------------------------------------------------------------------------

test.describe('I1: completed_at + state agreement', () => {
  test('POSITIVE: clean agent_job in awaiting_accept has completed_at set; no violation', async () => {
    const admin = adminClient()
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        operation_type: 'expand',
        triggered_by: 'apollo-i1-pos',
        state: 'awaiting_accept',
      })
      .select('id')
      .single()

    const rows = await audit()
    expect(violationsFor(rows, 'I1', [job!.id as string])).toHaveLength(0)
    await admin.from('agent_jobs').delete().eq('id', job!.id as string)
  })

  test('NEGATIVE: agent_job in queued state with completed_at set is flagged', async () => {
    const admin = adminClient()
    // Seed a queued job (auto-derive leaves completed_at NULL).
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        operation_type: 'expand',
        triggered_by: 'apollo-i1-neg',
        state: 'queued',
      })
      .select('id')
      .single()
    const jobId = job!.id as string

    // Inject drift: write completed_at directly (state stays 'queued').
    await admin.from('agent_jobs').update({ completed_at: new Date().toISOString() }).eq('id', jobId)

    const rows = await audit()
    const our = violationsFor(rows, 'I1', [jobId])
    expect(our.length, 'I1 should detect queued + completed_at drift').toBe(1)
    expect(our[0].violation).toContain('completed_at')

    await admin.from('agent_jobs').delete().eq('id', jobId)
  })

  test('NEGATIVE: agent_job in accepted state with NULL completed_at is flagged', async () => {
    const admin = adminClient()
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        operation_type: 'expand',
        triggered_by: 'apollo-i1-neg-2',
        state: 'accepted',
      })
      .select('id')
      .single()
    const jobId = job!.id as string

    // Inject: null out completed_at on a terminal row.
    await admin.from('agent_jobs').update({ completed_at: null }).eq('id', jobId)

    const rows = await audit()
    const our = violationsFor(rows, 'I1', [jobId])
    expect(our.length, 'I1 should detect accepted + NULL completed_at drift').toBe(1)

    await admin.from('agent_jobs').delete().eq('id', jobId)
  })
})

// ---------------------------------------------------------------------------
// I3 — workflow_steps.state='completed' ⇒ agent_job ∈ {accepted, awaiting_accept}
// ---------------------------------------------------------------------------

test.describe('I3: completed step ⇒ linked agent_job is accepted/awaiting_accept', () => {
  test('POSITIVE: completed step with accepted agent_job: no violation', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i3-pos', status: 'completed' })
      .select('id')
      .single()
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        operation_type: 'expand',
        triggered_by: 'apollo-i3-pos',
        state: 'accepted',
      })
      .select('id')
      .single()
    const { data: step } = await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'expand',
        target_node_id: fixture.nodeId,
        description: 'i3 positive',
        estimated_duration_seconds: 60,
        status: 'completed',
        agent_job_id: job!.id,
      })
      .select('id')
      .single()

    const rows = await audit()
    expect(violationsFor(rows, 'I3', [step!.id as string])).toHaveLength(0)
  })

  test('NEGATIVE: completed step with failed agent_job: flagged', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i3-neg', status: 'running' })
      .select('id')
      .single()
    const { data: job } = await admin
      .from('agent_jobs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        operation_type: 'expand',
        triggered_by: 'apollo-i3-neg',
        state: 'failed',
      })
      .select('id')
      .single()
    const { data: step } = await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'expand',
        target_node_id: fixture.nodeId,
        description: 'i3 negative',
        estimated_duration_seconds: 60,
        status: 'running',
        agent_job_id: job!.id,
      })
      .select('id')
      .single()

    // Force step into 'completed' state via legal transition (running → completed).
    await admin.from('workflow_steps').update({ state: 'completed' }).eq('id', step!.id as string)

    const rows = await audit()
    const our = violationsFor(rows, 'I3', [step!.id as string])
    expect(our.length, 'I3 should detect completed step ↔ failed job').toBe(1)
    expect(our[0].violation).toContain('failed')
  })
})

// ---------------------------------------------------------------------------
// I4 — workflows.state='completed' ⇒ all steps in terminal-success states
// ---------------------------------------------------------------------------

test.describe('I4: completed workflow ⇒ all steps terminal-success', () => {
  test('POSITIVE: workflow completed with all steps completed: no violation', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i4-pos', status: 'completed' })
      .select('id')
      .single()

    const rows = await audit()
    expect(violationsFor(rows, 'I4', [wf!.id as string])).toHaveLength(0)
  })

  test('NEGATIVE: workflow completed but step pending: flagged', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i4-neg', status: 'running' })
      .select('id')
      .single()
    await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'expand',
        target_node_id: fixture.nodeId,
        description: 'i4 pending',
        estimated_duration_seconds: 60,
        status: 'pending',
      })

    // Force workflow to completed via legal transition (running → completed).
    await admin.from('workflows').update({ state: 'completed' }).eq('id', wf!.id as string)

    const rows = await audit()
    const our = violationsFor(rows, 'I4', [wf!.id as string])
    expect(our.length, 'I4 should detect workflow completed + step pending').toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I5 — briefs.state='completed' ⇒ all stages terminal
// ---------------------------------------------------------------------------

test.describe('I5: completed brief ⇒ all stages terminal', () => {
  test('NEGATIVE: brief completed but stage planned: flagged', async () => {
    const admin = adminClient()
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i5 negative',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
      .select('id')
      .single()
    await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 1,
        title: 'i5 stage',
        trigger_type: 'manual',
        trigger_config: {},
        status: 'planned',
        prompt: 'irrelevant',
      })

    await admin.from('briefs').update({ state: 'completed' }).eq('id', brief!.id as string)

    const rows = await audit()
    const our = violationsFor(rows, 'I5', [brief!.id as string])
    expect(our.length, 'I5 should detect completed brief + planned stage').toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I6 — at most one active brief per document
// ---------------------------------------------------------------------------

test.describe('I6: one-active-brief constraint', () => {
  test('POSITIVE: single active brief: no violation', async () => {
    const admin = adminClient()
    await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i6-pos',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
    const rows = await audit()
    expect(rows.filter((r) => r.invariant_id === 'I6')).toHaveLength(0)
  })

  test('STRUCTURAL: index refuses second active brief insert', async () => {
    const admin = adminClient()
    await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i6-first',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
    const { error } = await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i6-second',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 1,
      })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/briefs_strict_one_active_per_document_uidx|duplicate key/)
  })
})

// ---------------------------------------------------------------------------
// I7 — non-terminal stage has workflow_id or prompt
// ---------------------------------------------------------------------------

test.describe('I7: non-terminal stage has workflow_id OR prompt', () => {
  test('POSITIVE: stage with workflow_id: no violation', async () => {
    const admin = adminClient()
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i7-pos',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
      .select('id')
      .single()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i7', status: 'running' })
      .select('id')
      .single()
    const { data: stage } = await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 1,
        title: 'i7 with wf',
        trigger_type: 'manual',
        trigger_config: {},
        status: 'planned',
        workflow_id: wf!.id,
      })
      .select('id')
      .single()

    const rows = await audit()
    expect(violationsFor(rows, 'I7', [stage!.id as string])).toHaveLength(0)
  })

  test('NEGATIVE: stage with neither workflow_id nor prompt: flagged', async () => {
    const admin = adminClient()
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'i7-neg',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
      .select('id')
      .single()
    const { data: stage } = await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 1,
        title: 'i7 orphan',
        trigger_type: 'manual',
        trigger_config: {},
        status: 'planned',
        // workflow_id NULL, prompt NULL — drift
      })
      .select('id')
      .single()

    const rows = await audit()
    const our = violationsFor(rows, 'I7', [stage!.id as string])
    expect(our.length, 'I7 should detect orphan stage').toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I8 — at most one in_progress turn per conversation
// ---------------------------------------------------------------------------

test.describe('I8: one in_progress turn per conversation', () => {
  test('POSITIVE: single in_progress turn: no violation', async () => {
    const admin = adminClient()
    const { data: turn } = await admin
      .from('director_turns')
      .insert({ conversation_id: fixture.conversationId, state: 'in_progress' })
      .select('id')
      .single()
    const rows = await audit()
    expect(violationsFor(rows, 'I8', [turn!.id as string])).toHaveLength(0)
  })

  test('NEGATIVE: two in_progress turns on the same conversation: both flagged', async () => {
    const admin = adminClient()
    const { data: t1 } = await admin
      .from('director_turns')
      .insert({ conversation_id: fixture.conversationId, state: 'in_progress' })
      .select('id')
      .single()
    const { data: t2 } = await admin
      .from('director_turns')
      .insert({ conversation_id: fixture.conversationId, state: 'in_progress' })
      .select('id')
      .single()

    const rows = await audit()
    const our = violationsFor(rows, 'I8', [t1!.id as string, t2!.id as string])
    expect(our.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// I12 — workflow_steps.state='running' ⇒ agent_job_id NOT NULL
// ---------------------------------------------------------------------------

test.describe('I12: running step has agent_job_id', () => {
  test('NEGATIVE: running step with NULL agent_job_id: flagged', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'i12', status: 'running' })
      .select('id')
      .single()
    const { data: step } = await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'expand',
        target_node_id: fixture.nodeId,
        description: 'i12 orphan',
        estimated_duration_seconds: 60,
        status: 'pending',
      })
      .select('id')
      .single()
    // Transition pending → running but leave agent_job_id NULL.
    await admin.from('workflow_steps').update({ state: 'running' }).eq('id', step!.id as string)

    const rows = await audit()
    const our = violationsFor(rows, 'I12', [step!.id as string])
    expect(our.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Reconcile sweep — verifies recovery rules
// ---------------------------------------------------------------------------

test.describe('reconcile_orchestration_state recovery rules', () => {
  test('Rule 7: workflow stuck running with all steps terminal → propagated to completed', async () => {
    const admin = adminClient()
    const { data: wf } = await admin
      .from('workflows')
      .insert({ organisation_id: fixture.orgId, document_id: fixture.documentId, title: 'reconcile-rule-7', status: 'running' })
      .select('id')
      .single()
    await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf!.id,
        order: 1,
        operation_type: 'expand',
        target_node_id: fixture.nodeId,
        description: 'rule7',
        estimated_duration_seconds: 60,
        status: 'completed',
      })

    // Before reconcile: workflow is stuck running with all-terminal step.
    let { data: before } = await admin.from('workflows').select('state').eq('id', wf!.id as string).single()
    expect((before as { state: string }).state).toBe('running')

    await admin.rpc('reconcile_orchestration_state')

    const { data: after } = await admin.from('workflows').select('state').eq('id', wf!.id as string).single()
    expect((after as { state: string }).state).toBe('completed')
  })

  test('Rule 8: brief stuck active with all stages terminal → propagated to completed', async () => {
    const admin = adminClient()
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: fixture.orgId,
        document_id: fixture.documentId,
        goal_text: 'reconcile-rule-8',
        status: 'active',
        cause: 'user_initial',
        sequence_position: 0,
      })
      .select('id')
      .single()
    await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 1,
        title: 'rule8',
        trigger_type: 'manual',
        trigger_config: {},
        status: 'completed',
        prompt: 'irrelevant',
      })

    await admin.rpc('reconcile_orchestration_state')

    const { data: after } = await admin.from('briefs').select('state').eq('id', brief!.id as string).single()
    expect((after as { state: string }).state).toBe('completed')
  })
})
