// Spec: stelavox_phase3_test_plan_v1_0.md §6 — TC-B-01..08
// RLS hides existence: cross-tenant access returns 404, never 403.

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'

const BASE = 'http://localhost:3000'

async function ctxB() { return request.newContext({ baseURL: BASE, storageState: USERS.B.storageState }) }
async function ctxNone() { return request.newContext({ baseURL: BASE }) }

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

async function setupBeatForA(orgId: string, prefix: string) {
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
    order: 1, depth: 4, layer_index: 4, name: 'B', status: 'draft', version: 3,
  }).select('id').single()
  // One node_versions row so /versions/1 has something to potentially hit
  await admin.from('node_versions').insert({
    node_id: beat!.id, organisation_id: orgId, version: 1,
    summary: tiptapDoc('a-summary'), prose: tiptapDoc('a-prose'),
    changed_by: 'agent_expand',
  })
  return { projectId: project!.id, beatId: beat!.id }
}

test.describe('Phase 3 — RLS boundary', () => {
  let orgA: string

  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-B-01 — User B PATCH on User A node returns 404', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-01')
    const ctx = await ctxB()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('intruder') },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-02 — User B GET versions on User A node returns 404', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-02')
    const ctx = await ctxB()
    const res = await ctx.get(`/api/nodes/${beatId}/versions`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-03 — User B GET single version on User A node returns 404 not_found', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-03')
    const ctx = await ctxB()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/1`)
    expect(res.status()).toBe(404)
    // node-level 404, NOT version_not_found
    expect((await res.json()).error).toBe('not_found')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-04 — Anonymous PATCH returns 401', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-04')
    const ctx = await ctxNone()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x') },
    })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-05 — Anonymous GET versions returns 401', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-05')
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/nodes/${beatId}/versions`)
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-06 — Anonymous GET single version returns 401', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-06')
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/1`)
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-07 — Forged service-role-shaped header has no effect', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-07')
    const ctx = await request.newContext({
      baseURL: BASE,
      extraHTTPHeaders: { 'x-supabase-role': 'service_role' },
    })
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x') },
    })
    // Without a valid session cookie, the route should still return 401
    expect(res.status()).toBe(401)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-B-08 — expected_version cannot leak existence of inaccessible nodes', async () => {
    const { projectId, beatId } = await setupBeatForA(orgA, 'TC-B-08')
    const ctx = await ctxB()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), expected_version: 1 },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    // No 409 / version_conflict ever surfaces for User B
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })
})
