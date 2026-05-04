// API integration tests for /api/projects/[projectId]/context-nodes
// and the Phase 4 amendments to /api/nodes/[nodeId]/{move,DELETE,PATCH}.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-A-01..TC-A-14, TC-A-32..TC-A-36
//       stelavox_phase4_api_contract_v1_0.md §3.1, §3.2, §3.4, §2.5 G-5
//
// Mirrors tests/api/nodes.spec.ts patterns: Playwright `request`
// contexts with stored auth state, adminClient() for setup/teardown
// via service role.

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import {
  createContextNodeFixture, linkContextFixture, shorthandCharacter,
} from '../helpers/context-fixtures'

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
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

async function setupProject(orgId: string, name: string) {
  const { data } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  return data!
}

async function setupNovelDocument(projectId: string, orgId: string, name: string) {
  const { data } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id:      projectId,
    p_organisation_id: orgId,
    p_name:            name,
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  return data as {
    document:  { id: string; root_node_id: string }
    root_node: { id: string }
  }
}

// ─── TC-A-01..TC-A-09: POST validation paths ─────────────────────────────

test('TC-A-01 POST creates a project-scoped character', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-01-project')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: {
      scope: 'project', node_type: 'character', name: 'Elena',
      metadata: { role: 'protagonist' },
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.node).toMatchObject({
    node_category: 'context',
    scope:         'project',
    document_id:   null,
    parent_id:     null,
    node_type:     'character',
    name:          'Elena',
    is_leaf:       false,
  })
  expect(body.node.id).toMatch(/^[0-9a-f-]{36}$/)
  expect(body.node.metadata).toMatchObject({ role: 'protagonist' })
  await ctx.dispose()
})

test('TC-A-02 POST creates a document-scoped location', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-02-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-02-doc')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: {
      scope: 'document', document_id: setup.document.id,
      node_type: 'location', name: 'The North Tower',
    },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.node.scope).toBe('document')
  expect(body.node.document_id).toBe(setup.document.id)
  expect(body.node.node_type).toBe('location')
  await ctx.dispose()
})

test('TC-A-03 POST scope=document without document_id → 400 scope_document_mismatch', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-03-project')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: { scope: 'document', node_type: 'character', name: 'X' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('scope_document_mismatch')
  await ctx.dispose()
})

test('TC-A-04 POST scope=project with document_id → 400 scope_document_mismatch', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-04-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-04-doc')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: {
      scope: 'project', document_id: setup.document.id,
      node_type: 'character', name: 'X',
    },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('scope_document_mismatch')
  await ctx.dispose()
})

test('TC-A-05 POST unknown node_type (extended type) → 400 invalid_node_type', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-05-project')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: { scope: 'project', node_type: 'evidence', name: 'X' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_node_type')
  await ctx.dispose()
})

test('TC-A-06 POST empty name (whitespace) → 400 invalid_name', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-06-project')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: { scope: 'project', node_type: 'character', name: '   ' },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_name')
  await ctx.dispose()
})

test('TC-A-07 POST unknown field → 400 unknown_field', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-07-project')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: {
      scope: 'project', node_type: 'character', name: 'Elena',
      parent_id: '00000000-0000-4000-8000-000000000001',
    },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('unknown_field')
  await ctx.dispose()
})

test('TC-A-08 POST mismatched document → 400 document_not_in_project', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const projectA = await setupProject(orgId, 'TC-A-08-project-A')
  const projectB = await setupProject(orgId, 'TC-A-08-project-B')
  const setupB = await setupNovelDocument(projectB.id, orgId, 'TC-A-08-doc')

  const ctx = await ctxA()
  // Try to create a document-scoped context node in projectA referencing
  // projectB's document.
  const res = await ctx.post(`/api/projects/${projectA.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: {
      scope: 'document', document_id: setupB.document.id,
      node_type: 'character', name: 'X',
    },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('document_not_in_project')
  await ctx.dispose()
})

test('TC-A-09 POST non-existent project → 404 project_not_found', async () => {
  const ctx = await ctxA()
  const res = await ctx.post(`/api/projects/00000000-0000-4000-8000-000000000999/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: { scope: 'project', node_type: 'character', name: 'X' },
  })
  expect(res.status()).toBe(404)
  expect((await res.json()).error).toBe('project_not_found')
  await ctx.dispose()
})

// ─── TC-A-10..TC-A-14: GET list with filters and pagination ──────────────

test('TC-A-10 GET lists project + document scope by default', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-10-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-10-doc')

  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Alice',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Bob',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: setup.document.id,
    node_type: 'character', name: 'Carla',
  })

  const ctx = await ctxA()
  const res = await ctx.get(`/api/projects/${project.id}/context-nodes`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  const names = body.context_nodes.map((n: { name: string }) => n.name)
  expect(names.sort()).toEqual(['Alice', 'Bob', 'Carla'])
  expect(body.total).toBe(3)
  expect(body.has_more).toBe(false)
  await ctx.dispose()
})

test('TC-A-11 GET filters by scope=project', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-11-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-11-doc')

  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Alice',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Bob',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: setup.document.id,
    node_type: 'character', name: 'Carla',
  })

  const ctx = await ctxA()
  const res = await ctx.get(`/api/projects/${project.id}/context-nodes?scope=project`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  const names = body.context_nodes.map((n: { name: string }) => n.name)
  expect(names.sort()).toEqual(['Alice', 'Bob'])
  expect(body.total).toBe(2)
  await ctx.dispose()
})

test('TC-A-12 GET filters by document_id (returns project + that doc)', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-12-project')
  const docA = await setupNovelDocument(project.id, orgId, 'TC-A-12-docA')
  const docB = await setupNovelDocument(project.id, orgId, 'TC-A-12-docB')

  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Alice',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Bob',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: docA.document.id,
    node_type: 'character', name: 'Carla',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: docB.document.id,
    node_type: 'character', name: 'Diana',
  })

  const ctx = await ctxA()
  const res = await ctx.get(`/api/projects/${project.id}/context-nodes?document_id=${docA.document.id}`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  const names = body.context_nodes.map((n: { name: string }) => n.name)
  expect(names.sort()).toEqual(['Alice', 'Bob', 'Carla'])    // Diana excluded
  await ctx.dispose()
})

test('TC-A-13 GET filters by node_type', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-13-project')

  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Alice',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'character', name: 'Bob',
  })
  await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'project',
    node_type: 'location', name: 'Tower',
  })

  const ctx = await ctxA()
  const res = await ctx.get(`/api/projects/${project.id}/context-nodes?node_type=location`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  const names = body.context_nodes.map((n: { name: string }) => n.name)
  expect(names).toEqual(['Tower'])
  expect(body.total).toBe(1)
  await ctx.dispose()
})

test('TC-A-14 GET paginates', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-14-project')

  // Service-role bulk insert 150 characters.
  for (let i = 0; i < 15; i++) {
    const inserts = Array.from({ length: 10 }, (_, j) => ({
      organisation_id: orgId,
      project_id:      project.id,
      parent_id:       null,
      node_category:   'context' as const,
      node_type:       'character' as const,
      scope:           'project' as const,
      name:            `Char ${String(i * 10 + j).padStart(3, '0')}`,
      status:          'draft' as const,
      version:         1,
      metadata:        {} as never,
    }))
    await adminClient().from('nodes').insert(inserts)
  }

  const ctx = await ctxA()
  const r1 = await ctx.get(`/api/projects/${project.id}/context-nodes?limit=50&offset=0`)
  expect(r1.status()).toBe(200)
  const b1 = await r1.json()
  expect(b1.context_nodes.length).toBe(50)
  expect(b1.total).toBe(150)
  expect(b1.has_more).toBe(true)

  const r2 = await ctx.get(`/api/projects/${project.id}/context-nodes?limit=50&offset=50`)
  const b2 = await r2.json()
  expect(b2.context_nodes.length).toBe(50)
  expect(b2.has_more).toBe(true)

  const r3 = await ctx.get(`/api/projects/${project.id}/context-nodes?limit=50&offset=100`)
  const b3 = await r3.json()
  expect(b3.context_nodes.length).toBe(50)
  expect(b3.has_more).toBe(false)
  await ctx.dispose()
})

// ─── TC-A-32: move on context returns 400 invalid_move_target ────────────

test('TC-A-32 move on a context node returns 400 invalid_move_target', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-32-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-32-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.patch(`/api/nodes/${elena.id}/move`, {
    headers: { 'content-type': 'application/json' },
    data: { parent_id: setup.root_node.id, position: 0 },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_move_target')
  await ctx.dispose()
})

// ─── TC-A-33..TC-A-35: DELETE context node with back-links + force ───────

test('TC-A-33 DELETE context with back-links → 409 cannot_delete_with_back_links', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-33-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-33-doc')

  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  await linkContextFixture(setup.root_node.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.delete(`/api/nodes/${elena.id}`)
  expect(res.status()).toBe(409)
  const body = await res.json()
  expect(body.error).toBe('cannot_delete_with_back_links')
  expect(body.back_links_count).toBe(1)
  await ctx.dispose()
})

test('TC-A-34 DELETE with ?force=true cascades', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-34-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-34-doc')

  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  await linkContextFixture(setup.root_node.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.delete(`/api/nodes/${elena.id}?force=true`)
  expect(res.status()).toBe(200)
  expect((await res.json()).deleted).toBe(true)

  // Verify the link is gone (FK cascade).
  const { data: leftover } = await adminClient()
    .from('node_context_links')
    .select('id')
    .eq('target_node_id', elena.id)
  expect(leftover ?? []).toEqual([])
  await ctx.dispose()
})

test('TC-A-35 DELETE context with no back-links succeeds without force', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-35-project')

  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.delete(`/api/nodes/${elena.id}`)
  expect(res.status()).toBe(200)
  expect((await res.json()).deleted).toBe(true)
  await ctx.dispose()
})

// ─── TC-A-36: PATCH context node ─────────────────────────────────────────

test('TC-A-36 PATCH context node updates content with expected_version', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-36-project')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  expect(elena.version).toBe(1)

  const ctx = await ctxA()
  const res = await ctx.patch(`/api/nodes/${elena.id}`, {
    headers: { 'content-type': 'application/json' },
    data: { summary: 'Updated summary', expected_version: 1 },
  })
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.node.version).toBe(2)
  expect(body.node.summary).toBe('Updated summary')
  expect(body.node.scope).toBe('project')
  await ctx.dispose()
})
