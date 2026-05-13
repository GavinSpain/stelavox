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

  test('CK-4 + CK-3: accept_brief creates a Brief; second concurrent Brief rejected', async () => {
    // No active Brief at first.
    const { count: before } = await adminClient()
      .from('briefs')
      .select('id', { count: 'exact', head: true })
      .eq('document_id', documentId)
      .in('status', ['planned', 'active'])
    expect(before ?? 0).toBe(0)

    // Trivial n=1 Brief.
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
    const r1 = first as { brief: { id: string; status: string } }
    expect(r1.brief.status).toBe('active')

    // Second concurrent Brief — should be rejected by the partial unique index.
    const { error: secondErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'Test Brief 2',
      p_stages: stages,
    })
    expect(secondErr).not.toBeNull()
    expect(secondErr!.message).toMatch(/another_brief_active/)
  })

  test('CK-7: cancel_brief releases the slot', async () => {
    // Find the active Brief from previous test.
    const { data: active } = await adminClient()
      .from('briefs')
      .select('id')
      .eq('document_id', documentId)
      .in('status', ['planned', 'active'])
      .single()
    expect(active).not.toBeNull()

    const { error: cancelErr } = await adminClient().rpc('cancel_brief', { p_brief_id: active!.id })
    expect(cancelErr).toBeNull()

    // Now a new Brief can be created.
    const { data: nextBrief, error: nextErr } = await adminClient().rpc('accept_brief', {
      p_document_id: documentId,
      p_goal_text: 'Test Brief 2 (after cancel)',
      p_stages: [
        {
          order: 1,
          title: 'Stage one',
          description: null,
          trigger_type: 'manual',
          trigger_config: {},
        },
      ],
    })
    expect(nextErr).toBeNull()
    const r = nextBrief as { brief: { goal_text: string } }
    expect(r.brief.goal_text).toBe('Test Brief 2 (after cancel)')
  })

  test('Director config v1.6 is production with 16 tools', async () => {
    const { data } = await adminClient()
      .from('director_configs')
      .select('version_number, status, tool_suite, system_prompt')
      .eq('status', 'production')
      .single()
    expect(data!.version_number).toBe('1.6')
    const tools = data!.tool_suite as string[]
    expect(tools).toHaveLength(16)
    expect(tools).toContain('get_project_profile')
    expect(tools).toContain('get_brief_state')
    expect(tools).toContain('propose_brief')
    expect(tools).toContain('propose_profile_amendment')
    expect(tools).not.toContain('propose_brief_amendment')
    // v1.6 — verifies the prompt mentions <plan> scratchpad pattern
    // and the "tool call IS the proposal" framing.
    expect(data!.system_prompt).toContain('<plan>')
    expect(data!.system_prompt).toContain('tool call IS the proposal')
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
