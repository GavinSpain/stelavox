// TC-A-15 — Workflow approve + execute happy path with one refine step.
//
// Originally listed in Phase 5b Test Plan §10.2 as a cloud-smoke case.
// Closed off this session as a Playwright integration test against the
// local dev server. Exercises:
//
//   1. Seed a draft workflow + one refine step against the j5-novel
//      fixture (admin client; no model in the loop yet).
//   2. Authenticate as j5-walk via the UI (Playwright login).
//   3. POST /api/director/workflows/[id]/approve via page.request.post()
//      — uses the captured cookie session, exercising the real
//      author-of-conversation gate and locked-node check.
//   4. Poll for workflow.status to reach 'completed' (or 'running' if
//      the in-dev waitUntil() doesn't drive completion in-process).
//   5. Verify the underlying agent_job ran and the target node has a
//      new version.
//
// Cost: ~$0.005 per run on Haiku 4.5 (one refine LLM call).

import { test, expect } from '@playwright/test'
import { adminClient } from '../helpers/db'
import { APP_URL } from '../helpers/auth'
import { execSync } from 'child_process'
import { resolve } from 'path'

const J5_USER = {
  email: 'j5-walk@example.com',
  password: 'Test1234!Test1234!',
}

interface Setup {
  organisationId: string
  projectId: string
  documentId: string
  conversationId: string
  workflowId: string
  stepId: string
  targetNodeId: string
  initialNodeVersion: number
}

let setup: Setup | null = null

test.describe('TC-A-15 — Workflow approve + execute happy path', () => {
  test.beforeAll(async () => {
    // Re-seed j5-novel to clear prior workflow state.
    execSync('npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf8',
    })

    const admin = adminClient()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const user = (users?.users ?? []).find((u) => u.email === J5_USER.email)
    if (!user) throw new Error('test user missing')
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', user.id)
      .single()
    if (!member) throw new Error('member missing')
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('organisation_id', member.organisation_id)
      .eq('name', 'j5-novel')
      .single()
    if (!project) throw new Error('project missing')
    const { data: doc } = await admin
      .from('documents')
      .select('id')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!doc) throw new Error('doc missing')

    // Pick an unlocked Scene node for the refine step.
    // Phase 6: nodes.locked dropped. Fixture data starts unlocked so a
    // simple first-by-order pick is correct here.
    const { data: scene } = await admin
      .from('nodes')
      .select('id, version')
      .eq('document_id', doc.id)
      .eq('node_type', 'scene')
      .order('order')
      .limit(1)
      .single()
    if (!scene) throw new Error('no unlocked scene')

    // Create a conversation (the workflow approve route's author-gate
    // looks up the first user-authored message in the conversation).
    const { data: conv } = await admin
      .from('conversations')
      .insert({
        organisation_id: member.organisation_id,
        document_id: doc.id,
      })
      .select('id')
      .single()
    if (!conv) throw new Error('conversation insert failed')

    // Seed a user message authored by j5-walk so the author gate passes.
    await admin.from('conversation_messages').insert({
      conversation_id: conv.id,
      role: 'user',
      content: 'Test seed for TC-A-15.',
      sequence: 1,
      author_user_id: user.id,
      tool_calls: [],
      turn_state: 'final',
    })

    // Create a draft workflow with one refine step.
    const { data: wf } = await admin
      .from('workflows')
      .insert({
        organisation_id: member.organisation_id,
        document_id: doc.id,
        conversation_id: conv.id,
        title: 'TC-A-15 test workflow',
        description: 'Single refine step on an unlocked scene summary.',
        impact_summary: 'Refines one scene summary.',
        status: 'draft',
        estimated_total_minutes: 1,
        locked_nodes_requiring_unlock: [],
      })
      .select('id')
      .single()
    if (!wf) throw new Error('workflow insert failed')

    const { data: step } = await admin
      .from('workflow_steps')
      .insert({
        workflow_id: wf.id,
        order: 1,
        operation_type: 'refine',
        target_node_id: scene.id,
        description: 'Tighten the scene summary; remove redundant phrases.',
        estimated_duration_seconds: 30,
        parameters: {
          target_field: 'summary',
          instruction: 'Tighten this scene summary by 10–20%. Keep the same beats and the same voice.',
        },
        depends_on_step_orders: [],
        status: 'pending',
      })
      .select('id')
      .single()
    if (!step) throw new Error('step insert failed')

    setup = {
      organisationId: member.organisation_id,
      projectId: project.id,
      documentId: doc.id,
      conversationId: conv.id,
      workflowId: wf.id,
      stepId: step.id,
      targetNodeId: scene.id,
      initialNodeVersion: scene.version,
    }
  })

  test('approve transitions the workflow to running/completed and updates the target node', async ({ page }) => {
    test.slow() // Allows up to 90s for the agent_jobs run to complete.
    if (!setup) throw new Error('setup not initialised')

    // Login (cookie-based auth captured into the Playwright context).
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', J5_USER.email)
    await page.fill('input[type="password"]', J5_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    // POST approve with default body (approves all pending steps).
    const res = await page.request.post(
      `${APP_URL}/api/director/workflows/${setup.workflowId}/approve`,
      { data: {} },
    )
    // 200 OK on already-approved (idempotent path) or 202 Accepted on
    // first-time approval (the route returns 202 because the executor
    // continuation runs via waitUntil() rather than inline).
    expect([200, 202], `approve response body: ${await res.text()}`).toContain(res.status())
    const body = await res.json()
    // The route returns the canonical workflow body either inline or
    // wrapped under `.workflow`. Normalise.
    const workflow = (body.workflow ?? body) as { status?: string }
    expect(['approved', 'running', 'completed']).toContain(workflow.status)

    // Poll for workflow completion via DB.
    const admin = adminClient()
    const deadline = Date.now() + 90_000
    let finalStatus = body.status as string
    while (Date.now() < deadline) {
      const { data: w } = await admin
        .from('workflows')
        .select('status')
        .eq('id', setup.workflowId)
        .maybeSingle()
      finalStatus = (w?.status as string) ?? finalStatus
      if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'paused') break
      await new Promise((r) => setTimeout(r, 2000))
    }

    expect(finalStatus).toBe('completed')

    // Verify the step transitioned to completed and has an agent_job_id.
    const { data: step } = await admin
      .from('workflow_steps')
      .select('status, agent_job_id')
      .eq('id', setup.stepId)
      .maybeSingle()
    expect(step?.status).toBe('completed')
    expect(step?.agent_job_id).toBeTruthy()

    // Verify the agent_job ran successfully.
    const { data: job } = await admin
      .from('agent_jobs')
      .select('status, tokens_input, tokens_output')
      .eq('id', step!.agent_job_id as string)
      .maybeSingle()
    expect(job?.status).toBe('accepted')
    expect((job?.tokens_input ?? 0) + (job?.tokens_output ?? 0)).toBeGreaterThan(0)

    // Verify the target node's version advanced.
    const { data: nodeAfter } = await admin
      .from('nodes')
      .select('version')
      .eq('id', setup.targetNodeId)
      .maybeSingle()
    expect((nodeAfter?.version ?? 0)).toBeGreaterThan(setup.initialNodeVersion)
  })
})
