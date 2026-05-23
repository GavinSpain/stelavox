/**
 * 2026-05-21 simplification — propose_workflow executor regression.
 *
 * Replaces the deleted propose-brief-amendment-executor.test.ts (Phase
 * F drop). propose_workflow is the new path for system-driven stage
 * planning: when a prompt-deferred stage's trigger fires, the system
 * invokes the Director with the stage's prompt; the Director responds
 * with propose_workflow; the executor resolves the unique
 * status='planning' stage on the active brief and returns the artefact
 * with stage_link metadata.
 *
 * Cases pinned here (against the real local DB; skipped without
 * SUPABASE_SERVICE_ROLE_KEY):
 *   1. Happy path: active brief with one stage in 'planning' →
 *      executor returns ok with workflow_proposal artefact carrying
 *      brief_id, stage_id, stage_order, stage_title, workflow.
 *   2. No active brief on document → 'no_active_brief' (with reason
 *      directing the model to call propose_brief instead).
 *   3. Active brief but no stage in 'planning' → 'no_planning_stage'.
 *   4. Multiple stages in 'planning' (schema-invariant violation) →
 *      'multiple_planning_stages' with a server-side error log.
 *   5. Invalid workflow shape (Zod-parse rejected) →
 *      'invalid_workflow_proposal' with the Zod error message in the
 *      reason.
 *   6. Step targets a node id not in the document →
 *      'invalid_workflow_proposal' with the missing id surfaced.
 *   7. Multi-step canonical-order sort backstop fires (same sort as
 *      propose_brief): out-of-order steps come back in canonical
 *      sibling order.
 */

import { describe, expect, it, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { execProposeWorkflow } from '@/lib/director/tools/write'
import type { DirectorSession } from '@/lib/director/types'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

const TEST_USER_EMAIL = 'author@stelavox.local'

async function getOrgIdForTestUser(): Promise<string> {
  const { data: users } = await svc.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === TEST_USER_EMAIL)
  if (!user) throw new Error(`test user ${TEST_USER_EMAIL} not found in local auth.users`)
  const { data } = await svc
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  if (!data) throw new Error(`test user has no org membership`)
  return data.organisation_id
}

interface BriefFixture {
  docId: string
  projectId: string
  rootId: string
  chapterId: string
  sceneIds: string[]
  briefId: string
  stage1Id: string
  stage2Id: string
}

async function seedBriefWithPlanningStage(
  orgId: string,
  namePrefix: string,
  opts: { stagesInPlanning?: number } = {},
): Promise<BriefFixture> {
  const stagesInPlanning = opts.stagesInPlanning ?? 1

  // Create project + document + a chapter with 3 scenes (used as
  // workflow step targets).
  const { data: project } = await svc
    .from('projects')
    .insert({ organisation_id: orgId, name: namePrefix })
    .select('id')
    .single()
  const { data: docRpc, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: namePrefix,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (docErr) throw new Error(`create_document RPC failed: ${docErr.message}`)
  const docId = (docRpc as { document: { id: string } }).document.id

  const { data: root } = await svc
    .from('nodes')
    .select('id')
    .eq('document_id', docId)
    .eq('depth', 0)
    .single()
  const { data: chapter } = await svc
    .from('nodes')
    .insert({
      organisation_id: orgId,
      document_id: docId,
      project_id: project!.id,
      node_category: 'structural',
      node_type: 'chapter',
      parent_id: root!.id,
      order: 1,
      depth: 1,
      layer_index: 1,
      name: 'chapter',
    })
    .select('id')
    .single()
  const sceneIds: string[] = []
  for (let i = 1; i <= 3; i++) {
    const { data: scene } = await svc
      .from('nodes')
      .insert({
        organisation_id: orgId,
        document_id: docId,
        project_id: project!.id,
        node_category: 'structural',
        node_type: 'scene',
        parent_id: chapter!.id,
        order: i,
        depth: 2,
        layer_index: 2,
        name: `scene-${i}`,
        summary: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Scene ${i}` }] }] },
      })
      .select('id')
      .single()
    sceneIds.push(scene!.id)
  }

  const { data: brief } = await svc
    .from('briefs')
    .insert({
      organisation_id: orgId,
      document_id: docId,
      status: 'active',
      sequence_position: 0,
      goal_text: `${namePrefix} — test brief`,
    })
    .select('id')
    .single()
  // Stage 1 is completed (predecessor). Stage 2 is the planning stage.
  const { data: stage1 } = await svc
    .from('brief_stages')
    .insert({
      brief_id: brief!.id,
      order: 1,
      title: 'Stage 1 (predecessor)',
      status: 'completed',
      trigger_type: 'manual',
      trigger_config: {},
      prompt: 'Stage 1 prompt',
    })
    .select('id')
    .single()
  const { data: stage2 } = await svc
    .from('brief_stages')
    .insert({
      brief_id: brief!.id,
      order: 2,
      title: 'Stage 2 (planning)',
      status: stagesInPlanning >= 1 ? 'planning' : 'planned',
      trigger_type: 'after_stage',
      trigger_config: { after_stage_order: 1 },
      prompt: 'Synthesise prose for all scenes in the chapter.',
    })
    .select('id')
    .single()

  if (stagesInPlanning >= 2) {
    // Bonus stage 3 also in 'planning' — used to trigger the
    // 'multiple_planning_stages' invariant guard. The DB CHECK
    // constraint allows it (a brief can have multiple planning stages
    // structurally; the push-model evaluator just shouldn't create
    // them).
    await svc
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 3,
        title: 'Stage 3 (also planning — invariant violation)',
        status: 'planning',
        trigger_type: 'after_stage',
        trigger_config: { after_stage_order: 2 },
        prompt: 'Bonus prompt',
      })
  }

  return {
    docId,
    projectId: project!.id,
    rootId: root!.id,
    chapterId: chapter!.id,
    sceneIds,
    briefId: brief!.id,
    stage1Id: stage1!.id,
    stage2Id: stage2!.id,
  }
}

async function cleanup(fx: BriefFixture): Promise<void> {
  await svc.from('brief_stages').delete().eq('brief_id', fx.briefId)
  await svc.from('briefs').delete().eq('id', fx.briefId)
  await svc.from('nodes').delete().eq('document_id', fx.docId)
}

describe.skipIf(!hasServiceKey)(
  'propose_workflow executor (post-simplification, 2026-05-21)',
  () => {
    let orgA: string
    beforeAll(async () => {
      orgA = await getOrgIdForTestUser()
    })

    it('happy path — planning stage resolves; artefact carries stage_link + workflow', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-happy-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeWorkflow(
          {
            title: 'Synthesise the chapter\'s 3 scenes',
            description: 'Generate prose for each scene',
            steps: fx.sceneIds.map((id) => ({
              operation_type: 'synthesise' as const,
              target_node_id: id,
              description: 'synthesise',
              estimated_duration_seconds: 45,
              parameters: {},
            })),
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(true)
        const r = result as unknown as { workflow_proposal: { brief_id: string; stage_id: string; stage_order: number; stage_title: string; workflow: { steps: unknown[] } } }
        expect(r.workflow_proposal.brief_id).toBe(fx.briefId)
        expect(r.workflow_proposal.stage_id).toBe(fx.stage2Id)
        expect(r.workflow_proposal.stage_order).toBe(2)
        expect(r.workflow_proposal.workflow.steps).toHaveLength(3)
      } finally {
        await cleanup(fx)
      }
    })

    it('no active brief on document → no_active_brief with helpful reason', async () => {
      // Empty document, no brief.
      const { data: project } = await svc
        .from('projects')
        .insert({ organisation_id: orgA, name: `exec-pw-no-brief-${Date.now()}` })
        .select('id')
        .single()
      const { data: docRpc } = await svc.rpc('create_document_with_layer_stack', {
        p_project_id: project!.id,
        p_organisation_id: orgA,
        p_name: 'no-brief',
        p_description: null as unknown as string,
        p_document_type: 'novel',
        p_authors: [],
      })
      const docId = (docRpc as { document: { id: string } }).document.id
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeWorkflow(
          {
            title: 'Test',
            steps: [{ operation_type: 'expand', target_node_id: '00000000-0000-0000-0000-000000000001', description: 'x', estimated_duration_seconds: 30, parameters: { child_count_target: 3 } }],
          },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('no_active_brief')
        expect((result as { reason: string }).reason).toMatch(/propose_brief/i)
      } finally {
        await svc.from('nodes').delete().eq('document_id', docId)
      }
    })

    it('active brief with no planning stage → no_planning_stage', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-nopl-${Date.now()}`, { stagesInPlanning: 0 })
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeWorkflow(
          {
            title: 'Test',
            steps: [{ operation_type: 'synthesise', target_node_id: fx.sceneIds[0], description: 'x', estimated_duration_seconds: 30, parameters: {} }],
          },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('no_planning_stage')
      } finally {
        await cleanup(fx)
      }
    })

    it('multiple stages in planning → multiple_planning_stages (invariant violation)', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-multi-${Date.now()}`, { stagesInPlanning: 2 })
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeWorkflow(
          {
            title: 'Test',
            steps: [{ operation_type: 'synthesise', target_node_id: fx.sceneIds[0], description: 'x', estimated_duration_seconds: 30, parameters: {} }],
          },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('multiple_planning_stages')
      } finally {
        await cleanup(fx)
      }
    })

    it('invalid workflow shape (no steps) → invalid_workflow_proposal', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-badwf-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        const result = await execProposeWorkflow(
          { title: 'Empty', steps: [] },
          session,
        )
        expect(result.ok).toBe(false)
        expect((result as { error: string }).error).toBe('invalid_workflow_proposal')
      } finally {
        await cleanup(fx)
      }
    })

    it('step target_node_id not in document → invalid_workflow_proposal naming the missing id', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-badnode-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        // Use a well-formed RFC 4122 v4 UUID that doesn't exist in the
        // document. Zod's UUID validator only accepts RFC 4122 v1/3/4/5
        // shapes (version digit + 8/9/a/b variant digit).
        const validV4ButMissing = '11111111-2222-4333-8444-555555555555'
        const result = await execProposeWorkflow(
          {
            title: 'Test',
            steps: [{ operation_type: 'synthesise', target_node_id: validV4ButMissing, description: 'x', estimated_duration_seconds: 30, parameters: {} }],
          },
          session,
        )
        expect(result.ok, JSON.stringify(result)).toBe(false)
        expect((result as { error: string }).error).toBe('invalid_workflow_proposal')
        expect((result as { reason: string }).reason).toMatch(/11111111-2222-4333-8444-555555555555/)
      } finally {
        await cleanup(fx)
      }
    })

    it('canonical-order sort backstop: out-of-order steps come back in canonical order', async () => {
      const fx = await seedBriefWithPlanningStage(orgA, `exec-pw-sort-${Date.now()}`)
      try {
        const session: DirectorSession = {
          conversation_id: '00000000-0000-0000-0000-000000000000',
          document_id: fx.docId,
          organisation_id: orgA,
          user_id: '',
        }
        // Submit steps in scrambled order (scene 3, 1, 2). The sort
        // should bring them back to canonical sibling order (1, 2, 3).
        const result = await execProposeWorkflow(
          {
            title: 'Synthesise all scenes',
            steps: [
              { operation_type: 'synthesise', target_node_id: fx.sceneIds[2], description: 's3', estimated_duration_seconds: 45, parameters: {} },
              { operation_type: 'synthesise', target_node_id: fx.sceneIds[0], description: 's1', estimated_duration_seconds: 45, parameters: {} },
              { operation_type: 'synthesise', target_node_id: fx.sceneIds[1], description: 's2', estimated_duration_seconds: 45, parameters: {} },
            ],
          },
          session,
        )
        expect(result.ok).toBe(true)
        const r = result as unknown as { workflow_proposal: { workflow: { steps: Array<{ target_node_id: string }> } } }
        expect(r.workflow_proposal.workflow.steps.map((s) => s.target_node_id)).toEqual(fx.sceneIds)
      } finally {
        await cleanup(fx)
      }
    })
  },
)
