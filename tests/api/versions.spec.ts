// Spec: stelavox_phase3_test_plan_v1_0.md §5.2, §5.3 — TC-A-17..29
//       stelavox_phase3_api_contract_v1_0.md §3.2, §3.3

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

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

async function setupBeatAndVersions(orgId: string, prefix: string, versionCount: number) {
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
  // Insert version rows
  for (let v = 1; v <= versionCount; v++) {
    await admin.from('node_versions').insert({
      node_id: beat!.id,
      organisation_id: orgId,
      version: v,
      summary: tiptapDoc(`summary-v${v}`),
      prose: tiptapDoc(`prose-v${v}`),
      notes: tiptapDoc(`notes-v${v}`),
      changed_by: 'agent_synthesise',
      change_reason: `version ${v}`,
    })
  }
  return { projectId: project!.id, beatId: beat!.id }
}

test.describe('Phase 3 — GET /api/nodes/[id]/versions', () => {
  let orgA: string

  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-A-17 — paginated list, newest first', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-17', 5)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(5)
    expect(body.has_more).toBe(false)
    expect(body.versions).toHaveLength(5)
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([5, 4, 3, 2, 1])
    // List shape omits content fields
    for (const v of body.versions) {
      expect(v.summary).toBeUndefined()
      expect(v.prose).toBeUndefined()
      expect(v.notes).toBeUndefined()
      expect(v.metadata).toBeUndefined()
    }
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-18 — limit reduces page size; has_more=true', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-18', 5)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions?limit=2`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([5, 4])
    expect(body.total).toBe(5)
    expect(body.has_more).toBe(true)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-19 — offset shifts the window', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-19', 5)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions?limit=2&offset=2`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.versions.map((v: { version: number }) => v.version)).toEqual([3, 2])
    expect(body.total).toBe(5)
    expect(body.has_more).toBe(true)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-20 — offset beyond total returns empty page', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-20', 5)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions?limit=10&offset=10`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.versions).toHaveLength(0)
    expect(body.total).toBe(5)
    expect(body.has_more).toBe(false)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-21 — limit > 100 returns 400 invalid_query', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-21', 1)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions?limit=500`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_query')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-22 — negative offset returns 400 invalid_query', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-22', 1)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions?offset=-1`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_query')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-23 — empty version list', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-23', 0)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.versions).toHaveLength(0)
    expect(body.total).toBe(0)
    expect(body.has_more).toBe(false)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-24 — non-existent node returns 404 not_found', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/00000000-0000-0000-0000-000000000000/versions`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })
})

test.describe('Phase 3 — GET /api/nodes/[id]/versions/[N]', () => {
  let orgA: string

  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-A-25 — single version returns full content fields', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-25', 3)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/3`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.version.version).toBe(3)
    expect(body.version.summary).toBe(tiptapDoc('summary-v3'))
    expect(body.version.prose).toBe(tiptapDoc('prose-v3'))
    expect(body.version.notes).toBe(tiptapDoc('notes-v3'))
    expect(body.version.changed_by).toBe('agent_synthesise')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-26 — non-existent version returns 404 version_not_found', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-26', 3)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/99`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('version_not_found')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-27 — non-existent node returns 404 not_found (not version_not_found)', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/00000000-0000-0000-0000-000000000000/versions/1`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-28 — non-numeric version returns 400 invalid_version_number', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-28', 1)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/abc`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_version_number')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-29 — version=0 returns 400 invalid_version_number', async () => {
    const { projectId, beatId } = await setupBeatAndVersions(orgA, 'TC-A-29', 1)
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${beatId}/versions/0`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_version_number')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })
})
