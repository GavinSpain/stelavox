// Spec: stelavox_phase3_test_plan_v1_0.md §7 — TC-D-01..06
// End-to-end verification of Migration 023's behaviour through the PATCH endpoint.

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'

const BASE = 'http://localhost:3000'

async function ctxA() { return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState }) }

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find(u => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id).single()
  return data!.organisation_id
}

async function setupBeat(orgId: string, prefix: string) {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects').insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id').single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id, p_organisation_id: orgId,
    p_name: `${prefix} doc`, p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const { data: act } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'A', status: 'draft', version: 1,
  }).select('id').single()
  const { data: chapter } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'C', status: 'draft', version: 1,
  }).select('id').single()
  const { data: scene } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: chapter!.id, node_category: 'structural', node_type: 'scene',
    order: 1, depth: 3, layer_index: 3, name: 'S', status: 'draft', version: 1,
  }).select('id').single()
  const { data: beat } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: scene!.id, node_category: 'structural', node_type: 'beat',
    order: 1, depth: 4, layer_index: 4, name: 'B', status: 'draft', version: 1,
  }).select('id').single()
  return { projectId: project!.id, beatId: beat!.id }
}

async function readNode(id: string) {
  const { data } = await adminClient().from('nodes').select('*').eq('id', id).maybeSingle()
  return data
}

test.describe('Phase 3 — Migration 023 trigger via PATCH', () => {
  let orgA: string

  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-D-01 — Content change bumps version by exactly 1', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-01')
    const ctx = await ctxA()
    await ctx.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('x') } })
    const after = await readNode(beatId)
    expect(after!.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-D-02 — Non-content change does not bump version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-02')
    // Bump up to v=5 first
    await adminClient().from('nodes').update({ prose: tiptapDoc('a') }).eq('id', beatId)
    await adminClient().from('nodes').update({ prose: tiptapDoc('b') }).eq('id', beatId)
    await adminClient().from('nodes').update({ prose: tiptapDoc('c') }).eq('id', beatId)
    await adminClient().from('nodes').update({ prose: tiptapDoc('d') }).eq('id', beatId)
    const before = await readNode(beatId)
    expect(before!.version).toBe(5)
    const ctx = await ctxA()
    await ctx.patch(`/api/nodes/${beatId}`, { data: { name: 'new' } })
    const after = await readNode(beatId)
    expect(after!.version).toBe(5)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-D-03 — Mixed PATCH sequence: bumps for content only', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-03')
    const ctx = await ctxA()
    // 1. prose → bump (v=2)
    await ctx.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('a') } })
    // 2. name only → no bump (v=2)
    await ctx.patch(`/api/nodes/${beatId}`, { data: { name: 'two' } })
    // 3. summary → bump (v=3)
    await ctx.patch(`/api/nodes/${beatId}`, { data: { summary: tiptapDoc('s') } })
    // 4. metadata unchanged ({} → {}) — Phase 2 default may or may not be {}.
    //    Set it explicitly first to ensure {} → {} semantics.
    await adminClient().from('nodes').update({ metadata: {} }).eq('id', beatId)
    const v3 = (await readNode(beatId))!.version  // unchanged from previous bump
    await ctx.patch(`/api/nodes/${beatId}`, { data: { metadata: {} } })
    const after = await readNode(beatId)
    expect(after!.version).toBe(v3)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-D-04 — updated_at advances on every PATCH', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-04')
    const before = await readNode(beatId)
    await new Promise(r => setTimeout(r, 50))
    const ctx = await ctxA()
    await ctx.patch(`/api/nodes/${beatId}`, { data: { name: 'x' } })
    const after = await readNode(beatId)
    expect(new Date(after!.updated_at).getTime())
      .toBeGreaterThan(new Date(before!.updated_at).getTime())
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-D-05 — Concurrent PATCHes serialised: one 200, one 409', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-05')
    const ctx1 = await ctxA()
    const ctx2 = await ctxA()
    const [r1, r2] = await Promise.all([
      ctx1.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('A'), expected_version: 1 } }),
      ctx2.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('B'), expected_version: 1 } }),
    ])
    const statuses = [r1.status(), r2.status()].sort()
    expect(statuses).toEqual([200, 409])
    const final = await readNode(beatId)
    expect(final!.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx1.dispose()
    await ctx2.dispose()
  })

  test('TC-D-06 — Service-role direct UPDATE bypasses expected_version (Phase 5 path)', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-D-06')
    // Bump to v=5
    for (const v of ['a', 'b', 'c', 'd']) {
      await adminClient().from('nodes').update({ prose: tiptapDoc(v) }).eq('id', beatId)
    }
    // Service role direct update — no expected_version, succeeds despite stale view
    const { error } = await adminClient().from('nodes')
      .update({ prose: tiptapDoc('agent-write') }).eq('id', beatId)
    expect(error).toBeNull()
    const after = await readNode(beatId)
    expect(after!.prose).toBe(tiptapDoc('agent-write'))
    await adminClient().from('projects').delete().eq('id', projectId)
  })
})
