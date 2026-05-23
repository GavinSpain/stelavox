/**
 * V1.x-A.1 — Profile + Brief substrate Playwright integration spec.
 *
 * End-to-end verification of:
 *   - CK-1: every new document has exactly one Project Profile (Migration 085 auto-create)
 *   - CK-2: get_project_profile returns the §6.1.3 payload shape
 *   - CK-3: one Brief at a time per document (partial unique index)
 *   - CK-4: trivial n=1 Brief proposal + accept_brief flow
 *   - CK-5: multi-stage Brief proposal flow (stage 1 workflow specified; stage 2 workflow:null)
 *   - CK-6: apply_profile_amendment RPC mutates preferences
 *   - CK-7: cancel_brief releases the partial unique index slot
 *   - CK-11: realtime publication contains project_profiles + briefs + brief_stages
 */

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

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

test.describe('V1.x-A.1 Profile + Brief substrate', () => {
  let orgA: string
  let projectId: string
  let documentId: string
  let profileId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)

    const { data: project } = await adminClient()
      .from('projects')
      .insert({ organisation_id: orgA, name: 'V1.x-A.1 test project' })
      .select()
      .single()
    projectId = project!.id

    const { data: doc, error: rpcErr } = await adminClient().rpc('create_document_with_layer_stack', {
      p_project_id: projectId,
      p_organisation_id: orgA,
      p_name: 'V1.x-A.1 test document',
      p_description: null as unknown as string,
      p_document_type: 'novel',
      p_authors: [],
    })
    if (rpcErr) throw new Error(`RPC failed: ${rpcErr.message}`)
    if (!doc) throw new Error('RPC returned null')
    const result = doc as unknown as {
      document: { id: string; profile_id: string }
      project_profile: { id: string }
    }
    documentId = result.document.id
    profileId = result.project_profile.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', projectId)
  })

  test('CK-1: every new document has a Project Profile (M-085 auto-create)', async () => {
    const { data } = await adminClient()
      .from('documents')
      .select('id, profile_id')
      .eq('id', documentId)
      .single()
    expect(data!.profile_id).toBe(profileId)
  })

  test('CK-1: Project Profile starts empty', async () => {
    const { data: profile } = await adminClient()
      .from('project_profiles')
      .select('id, goal_text, preferences')
      .eq('id', profileId)
      .single()
    expect(profile!.goal_text).toBeNull()
    expect(profile!.preferences).toEqual({})
  })

  test('CK-2: GET /api/profile/[id] returns §6.1.3 shape', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/profile/${profileId}`)
    expect(res.status()).toBe(200)
    const payload = await res.json()
    expect(payload).toHaveProperty('goal_text')
    expect(payload).toHaveProperty('preferences')
    expect(payload).toHaveProperty('recent_amendments')
    expect(payload.goal_text).toBeNull()
  })

  test('CK-6: apply_profile_amendment mutates preferences.constraints', async () => {
    const { data, error } = await adminClient().rpc('apply_profile_amendment', {
      p_profile_id: profileId,
      p_amendment_type: 'add_constraint',
      p_target_path: 'preferences.constraints',
      p_after: ['no flashbacks before chapter 4'],
      p_reason: 'Author rule.',
    })
    expect(error).toBeNull()
    const result = data as { preferences: { constraints: string[] } }
    expect(result.preferences.constraints).toEqual(['no flashbacks before chapter 4'])

    const { data: amendments } = await adminClient()
      .from('profile_amendments')
      .select('amendment_type, proposed_by')
      .eq('profile_id', profileId)
    expect(amendments).toHaveLength(1)
    expect(amendments![0].amendment_type).toBe('add_constraint')
  })

  test('CK-4 (M-183 contract): accept_brief creates active; second accept fails on strict-one-active index', async () => {
    // V1.x-B.3 (M-126/M-128) briefly made multi-Brief concurrency
    // first-class. M-183 (Director simplification, 2026-05-21) reverted
    // that by restoring `briefs_strict_one_active_per_document_uidx`,
    // a partial unique index on `briefs(document_id) WHERE status='active'`.
    // accept_brief still always INSERTs as 'active'; the second call on
    // the same document errors via the unique-violation surfacing
    // through the RPC.
    const { count: before } = await adminClient()
      .from('briefs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .in('status', ['active', 'queued'])
    expect(before ?? 0).toBe(0)

    const stages = [
      {
        order: 1,
        title: 'Stage one',
        description: 'Test stage',
        trigger_type: 'manual',
        trigger_config: {},
      },
    ]
    const { data: first, error: firstErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'Test Brief 1',
      p_stages: stages,
    })
    expect(firstErr).toBeNull()
    const r1 = first as { brief: { id: string; status: string }; initial_status: string }
    expect(r1.brief.status).toBe('active')
    expect(r1.initial_status).toBe('active')

    // Second accept on the same document — schema refuses via the
    // strict-one-active partial unique index (M-183).
    const { error: secondErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'Test Brief 2',
      p_stages: stages,
    })
    expect(secondErr).not.toBeNull()
    expect(secondErr!.message).toMatch(/unique|briefs_strict_one_active|already.*active/i)
  })

  test('CK-7 (M-183 contract): cancel_brief returns cascade summary; subsequent accept_brief succeeds on a clean document', async () => {
    // M-183 single-active-brief contract: only one active brief per
    // document at a time. cancel_brief returns a cascade summary
    // (cancelled_count + null promoted_brief_id since the queue path
    // was removed in M-183). After cancellation, accept_brief on the
    // same document succeeds because the partial unique index only
    // covers status='active' rows.
    //
    // Self-contained — does NOT depend on CK-4's leftover brief.
    // Cancels any pre-existing active brief on this document, then
    // creates a fresh one to exercise the cancel + re-accept flow.
    const { data: preExisting } = await adminClient()
      .from('briefs')
      .select('id')
      .eq('document_id', documentId)
      .eq('status', 'active')
    for (const existing of preExisting ?? []) {
      await adminClient().rpc('cancel_brief', {
        p_brief_id: existing.id,
        p_reason: 'CK-7 setup cleanup',
      })
    }

    // Seed a fresh active brief.
    const { data: seedBrief, error: seedErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'CK-7 seed brief',
      p_stages: [
        { order: 1, title: 'Stage one', description: null, trigger_type: 'manual', trigger_config: {} },
      ],
    })
    expect(seedErr).toBeNull()
    const seed = seedBrief as { brief: { id: string } }

    // Cancel the seeded brief and confirm cascade-summary shape.
    // M-200 (cascade_cancel_and_force_reset) defines the cancel_brief
    // return shape as the cascade counts: pending_stages_cancelled,
    // completed_stages_retained, workflows_cancelled, steps_cancelled,
    // jobs_cancelled, turns_cancelled. M-183 removed the queue concept,
    // so there is no `promoted_brief_id` in the response.
    const { data: cascade, error: cancelErr } = await adminClient().rpc('cancel_brief', {
      p_brief_id: seed.brief.id,
      p_reason: 'M-183 contract test',
    })
    expect(cancelErr).toBeNull()
    const r = cascade as {
      brief_id: string
      pending_stages_cancelled: number
      completed_stages_retained: number
      workflows_cancelled: number
      steps_cancelled: number
      jobs_cancelled: number
      turns_cancelled: number
    }
    expect(r.brief_id).toBe(seed.brief.id)
    expect(typeof r.pending_stages_cancelled).toBe('number')
    expect(typeof r.completed_stages_retained).toBe('number')

    // After cancellation, accept_brief succeeds (the cancelled brief
    // no longer occupies the partial unique index).
    const { data: nextBrief, error: nextErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'CK-7 post-cancel brief',
      p_stages: [
        { order: 1, title: 'Stage one', description: null, trigger_type: 'manual', trigger_config: {} },
      ],
    })
    expect(nextErr).toBeNull()
    const n = nextBrief as { brief: { goal_text: string }; initial_status: string }
    expect(n.brief.goal_text).toBe('CK-7 post-cancel brief')
    expect(n.initial_status).toBe('active')

    // Cleanup so subsequent tests don't inherit an active brief.
    const { data: leftover } = await adminClient()
      .from('briefs')
      .select('id')
      .eq('document_id', documentId)
      .eq('status', 'active')
    for (const l of leftover ?? []) {
      await adminClient().rpc('cancel_brief', { p_brief_id: l.id, p_reason: 'CK-7 teardown' })
    }
  })

  test('Production Director config has the simplified-brief-model contract', async () => {
    // 2026-05-21 simplification (M-184) introduced the contract:
    //   * propose_brief_amendment dropped
    //   * propose_workflow added (system-driven stage planning)
    //   * Net tool count 17
    // Subsequent migrations (M-185, M-186, ...) may have bumped the
    // version_number further (v1.25, v1.26, ...) without changing the
    // contract. Test asserts the contract, not a specific version pin,
    // so config promotions don't invalidate this test.
    const { data } = await adminClient()
      .from('director_configs')
      .select('version_number, status, tool_suite, system_prompt')
      .eq('status', 'production')
      .single()
    expect(data!.version_number).not.toBe('1.23') // v1.23 had the old amendment surface
    const tools = data!.tool_suite as string[]
    expect(tools).toHaveLength(17)
    expect(tools).toContain('get_project_profile')
    expect(tools).toContain('get_brief_state')
    expect(tools).toContain('propose_brief')
    expect(tools).toContain('propose_profile_amendment')
    expect(tools).toContain('cancel_brief')
    expect(tools).toContain('propose_workflow')
    expect(tools).toContain('report_capability_limit')
    // Dropped tool MUST NOT be present.
    expect(tools).not.toContain('propose_brief_amendment')
    expect(data!.system_prompt).toContain('<plan>')
    expect(data!.system_prompt).toContain('tool call IS the proposal')
    expect(data!.system_prompt).toContain('cancel_brief')
    expect(data!.system_prompt).toContain('after_stage_order')
    // New model guidance.
    expect(data!.system_prompt).toContain('propose_workflow')
    expect(data!.system_prompt).toContain('prompt')
    // Capability limit still in scope.
    expect(data!.system_prompt).toContain('report_capability_limit')
    // Note: the prompt may legitimately reference `propose_brief_amendment`
    // in a NEGATION context (e.g. "you do NOT call propose_brief_amendment
    // for this"). The contract is enforced by tool_suite above — the tool
    // is not in the registry, so the model cannot invoke it regardless of
    // what the prompt body says.
  })

  test('platform_config has the rolling-window key', async () => {
    const { data } = await adminClient()
      .from('platform_config')
      .select('key, value, value_type')
      .eq('key', 'agent.director_conversation_window_turns')
      .single()
    expect(data!.value_type).toBe('integer')
    expect(Number(data!.value)).toBeGreaterThan(0)
  })
})
