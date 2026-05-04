// Authorisation-boundary tests for the Phase 4 context surface.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-B-01..TC-B-08
//       stelavox_phase4_api_contract_v1_0.md §2.2

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient, anonClient } from '../helpers/db'
import {
  createContextNodeFixture, linkContextFixture, shorthandCharacter,
} from '../helpers/context-fixtures'

const BASE = 'http://localhost:3000'

async function ctxA() { return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState }) }
async function ctxB() { return request.newContext({ baseURL: BASE, storageState: USERS.B.storageState }) }
async function ctxNone() { return request.newContext({ baseURL: BASE }) }

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
    .from('projects').insert({ organisation_id: orgId, name }).select().single()
  return data!
}

async function setupNovelDocument(projectId: string, orgId: string, name: string) {
  const { data } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id: projectId, p_organisation_id: orgId, p_name: name,
    p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  return data as { document: { id: string; root_node_id: string }; root_node: { id: string } }
}

test('TC-B-01 User B cannot read User A context nodes', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-01-project')
  await shorthandCharacter(orgA, project.id, 'Elena (User A)')

  const ctx = await ctxB()
  const res = await ctx.get(`/api/projects/${project.id}/context-nodes`)
  expect(res.status()).toBe(404)
  expect((await res.json()).error).toBe('project_not_found')
  await ctx.dispose()
})

test('TC-B-02 User B cannot create context node in User A project', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-02-project')

  const ctx = await ctxB()
  const res = await ctx.post(`/api/projects/${project.id}/context-nodes`, {
    headers: { 'content-type': 'application/json' },
    data: { scope: 'project', node_type: 'character', name: 'Spy' },
  })
  expect(res.status()).toBe(404)
  expect((await res.json()).error).toBe('project_not_found')
  await ctx.dispose()
})

test('TC-B-03 User B cannot link to User A structural node', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-03-project')
  const setup = await setupNovelDocument(project.id, orgA, 'TC-B-03-doc')
  const elena = await shorthandCharacter(orgA, project.id, 'Elena')

  const ctx = await ctxB()
  const res = await ctx.post(`/api/nodes/${setup.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: elena.id },
  })
  expect(res.status()).toBe(404)
  await ctx.dispose()
})

test('TC-B-04 Same-org different-project linking rejected', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const projectP1 = await setupProject(orgA, 'TC-B-04-P1')
  const projectP2 = await setupProject(orgA, 'TC-B-04-P2')
  const setupP2 = await setupNovelDocument(projectP2.id, orgA, 'TC-B-04-docP2')
  const elena = await shorthandCharacter(orgA, projectP1.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${setupP2.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: elena.id },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('link_cross_project')
  await ctx.dispose()
})

test('TC-B-05 User B cannot DELETE User A link', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-05-project')
  const setup = await setupNovelDocument(project.id, orgA, 'TC-B-05-doc')
  const elena = await shorthandCharacter(orgA, project.id, 'Elena')
  await linkContextFixture(setup.root_node.id, elena.id, orgA)

  const ctx = await ctxB()
  const res = await ctx.delete(`/api/nodes/${setup.root_node.id}/context-links/${elena.id}`)
  expect(res.status()).toBe(404)
  await ctx.dispose()
})

test('TC-B-06 User B cannot list back-links of User A context node', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-06-project')
  const elena = await shorthandCharacter(orgA, project.id, 'Elena')

  const ctx = await ctxB()
  const res = await ctx.get(`/api/nodes/${elena.id}/back-links`)
  expect(res.status()).toBe(404)
  await ctx.dispose()
})

test('TC-B-07 Service role can read any context node', async () => {
  const orgA = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgA, 'TC-B-07-project')
  const elena = await shorthandCharacter(orgA, project.id, 'Elena')

  const { data, error } = await adminClient()
    .from('nodes')
    .select('id, name, node_category')
    .eq('id', elena.id)
    .single()
  expect(error).toBeNull()
  expect(data?.name).toBe('Elena')
})

test('TC-B-08 Anon client cannot read any context node via API', async () => {
  const ctx = await ctxNone()
  const res = await ctx.get(`/api/projects/00000000-0000-4000-8000-000000000999/context-nodes`)
  expect(res.status()).toBe(401)
  expect((await res.json()).error).toBe('unauthorised')
  await ctx.dispose()

  // Also verify the anon Supabase client (RLS-enforced) can't read context rows directly.
  const { data, error } = await anonClient()
    .from('nodes')
    .select('id')
    .eq('node_category', 'context')
    .limit(1)
  // RLS returns 0 rows for an anon caller — error is null, data is empty.
  expect(error).toBeNull()
  expect(data ?? []).toEqual([])
})
