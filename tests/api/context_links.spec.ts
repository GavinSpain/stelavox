// API integration tests for /api/nodes/[nodeId]/context-links and back-links.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-A-15..TC-A-31
//       stelavox_phase4_api_contract_v1_0.md §3.3, §3.4, §3.5, §3.6

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

// Insert a structural child node directly via service-role.
async function insertStructuralChild(args: {
  org_id: string; project_id: string; document_id: string;
  parent_id: string; node_type: string;
  order: number; depth: number; layer_index: number;
  name: string;
  locked?: boolean;
}) {
  const { data } = await adminClient()
    .from('nodes')
    .insert({
      organisation_id: args.org_id,
      project_id:      args.project_id,
      document_id:     args.document_id,
      parent_id:       args.parent_id,
      node_category:   'structural',
      node_type:       args.node_type,
      order:           args.order,
      depth:           args.depth,
      layer_index:     args.layer_index,
      name:            args.name,
      status:          'draft',
      version:         1,
      metadata:        {} as never,
    })
    .select()
    .single()
  if (args.locked && data) {
    // Phase 6: nodes.locked dropped; use node_author_locks.
    const { data: member } = await adminClient()
      .from('organisation_members').select('user_id')
      .eq('organisation_id', args.org_id).limit(1).single()
    if (member?.user_id) {
      await adminClient().from('node_author_locks').insert({
        node_id: data.id, organisation_id: args.org_id,
        locked_by_user_id: member.user_id, lock_reason: 'test fixture',
      })
    }
  }
  return data!
}

// ─── TC-A-15..TC-A-22: POST link guards ─────────────────────────────────

test('TC-A-15 POST link from structural to context succeeds', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-15-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-15-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${setup.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: elena.id },
  })
  expect(res.status()).toBe(201)
  const body = await res.json()
  expect(body.link).toMatchObject({
    source_node_id: setup.root_node.id,
    target_node_id: elena.id,
    link_type:      'structural_to_context',
  })
  expect(body.link.id).toMatch(/^[0-9a-f-]{36}$/)
  await ctx.dispose()
})

test('TC-A-16 POST link rejects context source', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-16-project')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  const marcus = await shorthandCharacter(orgId, project.id, 'Marcus')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${elena.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: marcus.id },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_link_source')
  await ctx.dispose()
})

test('TC-A-17 POST link rejects structural target', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-17-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-17-doc')
  const sibling = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Act 1',
  })

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${setup.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: sibling.id },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_link_target')
  await ctx.dispose()
})

test('TC-A-18 POST link rejects cross-project pair', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project1 = await setupProject(orgId, 'TC-A-18-projectA')
  const project2 = await setupProject(orgId, 'TC-A-18-projectB')
  const setup2 = await setupNovelDocument(project2.id, orgId, 'TC-A-18-docB')
  const elena = await shorthandCharacter(orgId, project1.id, 'Elena (in P1)')

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${setup2.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: elena.id },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('link_cross_project')
  await ctx.dispose()
})

test('TC-A-19 POST link rejects cross-document for document-scoped target', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-19-project')
  const docA = await setupNovelDocument(project.id, orgId, 'TC-A-19-docA')
  const docB = await setupNovelDocument(project.id, orgId, 'TC-A-19-docB')
  const atrium = await createContextNodeFixture({
    org_id: orgId, project_id: project.id, scope: 'document',
    document_id: docA.document.id,
    node_type: 'location', name: 'Atrium (in DocA)',
  })

  const ctx = await ctxA()
  // Try to link from docB's root.
  const res = await ctx.post(`/api/nodes/${docB.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: atrium.id },
  })
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('link_cross_document')
  await ctx.dispose()
})

test('TC-A-20 POST duplicate link returns 409 with existing link', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-20-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-20-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  const link = await linkContextFixture(setup.root_node.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.post(`/api/nodes/${setup.root_node.id}/context-links`, {
    headers: { 'content-type': 'application/json' },
    data: { context_node_id: elena.id },
  })
  expect(res.status()).toBe(409)
  const body = await res.json()
  expect(body.error).toBe('link_already_exists')
  expect(body.link.id).toBe(link.id)
  await ctx.dispose()
})

test.skip('TC-A-21 POST link blocked by source lock — SUPERSEDED Phase 6 D-A', async () => {
  // Phase 6 D-A: context links are EXCLUDED from the lock domain.
  // Locked nodes still accept new links (linking is annotation, not
  // content). Lock check was removed from
  // /api/nodes/[id]/context-links POST in 6.A.
})

test.skip('TC-A-22 POST link blocked by ancestor lock — SUPERSEDED Phase 6 D-A + D2', async () => {
  // Phase 6 D-A: context links excluded from lock domain.
  // Phase 6 D2: locks are per-node anyway — no ancestor cascade.
  // Doubly superseded.
})

// ─── TC-A-23..TC-A-25: DELETE link ──────────────────────────────────────

test('TC-A-23 DELETE link removes the row', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-23-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-23-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  await linkContextFixture(setup.root_node.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.delete(`/api/nodes/${setup.root_node.id}/context-links/${elena.id}`)
  expect(res.status()).toBe(200)
  expect((await res.json()).deleted).toBe(true)

  // Verify gone from DB.
  const { data } = await adminClient()
    .from('node_context_links')
    .select('id')
    .eq('source_node_id', setup.root_node.id)
    .eq('target_node_id', elena.id)
  expect(data ?? []).toEqual([])
  await ctx.dispose()
})

test('TC-A-24 DELETE non-existent link returns 404', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-24-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-24-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.delete(`/api/nodes/${setup.root_node.id}/context-links/${elena.id}`)
  expect(res.status()).toBe(404)
  expect((await res.json()).error).toBe('link_not_found')
  await ctx.dispose()
})

test.skip('TC-A-25 DELETE blocked by source lock — SUPERSEDED Phase 6 D-A', async () => {
  // Phase 6 D-A: context links excluded from lock domain. Lock check
  // removed from /api/nodes/[id]/context-links/[contextNodeId] DELETE
  // in 6.A.
})

// ─── TC-A-26..TC-A-30: GET links — direct, inherited, closest, suppression ───

test('TC-A-26 GET links lists direct entries', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-26-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-26-doc')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  const marcus = await shorthandCharacter(orgId, project.id, 'Marcus')
  await linkContextFixture(setup.root_node.id, elena.id, orgId)
  await linkContextFixture(setup.root_node.id, marcus.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${setup.root_node.id}/context-links`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  const directNames = body.direct.map((d: { context_node: { name: string } }) => d.context_node.name)
  expect(directNames.sort()).toEqual(['Elena', 'Marcus'])
  expect(body.inherited).toEqual([])
  await ctx.dispose()
})

test('TC-A-27 GET links includes inherited entries from ancestors', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-27-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-27-doc')
  const act1 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Act 1',
  })
  const ch3 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: act1.id, node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'Chapter 3',
  })
  const scene1 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: ch3.id, node_type: 'scene',
    order: 1, depth: 3, layer_index: 3, name: 'Scene 1',
  })
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  await linkContextFixture(setup.root_node.id, elena.id, orgId)  // root → Elena

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${scene1.id}/context-links`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.direct).toEqual([])
  expect(body.inherited).toHaveLength(1)
  expect(body.inherited[0].context_node.name).toBe('Elena')
  expect(body.inherited[0].inherited_from.id).toBe(setup.root_node.id)
  await ctx.dispose()
})

test('TC-A-28 GET links: closest ancestor wins on duplication', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-28-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-28-doc')
  const act1 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Act 1',
  })
  const ch3 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: act1.id, node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'Chapter 3',
  })
  const scene1 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: ch3.id, node_type: 'scene',
    order: 1, depth: 3, layer_index: 3, name: 'Scene 1',
  })
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  // Elena linked to BOTH root (depth 0) and Chapter 3 (depth 2).
  await linkContextFixture(setup.root_node.id, elena.id, orgId)
  await linkContextFixture(ch3.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${scene1.id}/context-links`)
  const body = await res.json()
  expect(body.inherited).toHaveLength(1)
  // Closest ancestor wins → Chapter 3 (depth 2), not the root (depth 0).
  expect(body.inherited[0].inherited_from.id).toBe(ch3.id)
  expect(body.inherited[0].inherited_from.depth).toBe(2)
  await ctx.dispose()
})

test('TC-A-29 GET links: direct supersedes inherited', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-29-project')
  const setup = await setupNovelDocument(project.id, orgId, 'TC-A-29-doc')
  const act1 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Act 1',
  })
  const ch3 = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: setup.document.id,
    parent_id: act1.id, node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'Chapter 3',
  })
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  // Elena linked to root (would be inherited on Chapter 3) AND to Chapter 3 (direct).
  await linkContextFixture(setup.root_node.id, elena.id, orgId)
  await linkContextFixture(ch3.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${ch3.id}/context-links`)
  const body = await res.json()
  expect(body.direct).toHaveLength(1)
  expect(body.direct[0].context_node.name).toBe('Elena')
  // Inherited is empty for Elena — direct supersedes.
  expect(body.inherited).toEqual([])
  await ctx.dispose()
})

test('TC-A-30 GET links rejects context-node sources', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-30-project')
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${elena.id}/context-links`)
  expect(res.status()).toBe(400)
  expect((await res.json()).error).toBe('invalid_link_source')
  await ctx.dispose()
})

// ─── TC-A-31: GET back-links ────────────────────────────────────────────

test('TC-A-31 GET back-links lists structural sources ordered by document', async () => {
  const orgId = await getUserOrgId(USERS.A.email)
  const project = await setupProject(orgId, 'TC-A-31-project')
  const docA = await setupNovelDocument(project.id, orgId, 'A — The Northern Light')
  const docB = await setupNovelDocument(project.id, orgId, 'B — Other Doc')
  const ch3A = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: docA.document.id,
    parent_id: docA.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Chapter 3',
  })
  const ch5B = await insertStructuralChild({
    org_id: orgId, project_id: project.id, document_id: docB.document.id,
    parent_id: docB.root_node.id, node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: 'Chapter 5',
  })
  const elena = await shorthandCharacter(orgId, project.id, 'Elena')
  await linkContextFixture(ch3A.id, elena.id, orgId)
  await linkContextFixture(ch5B.id, elena.id, orgId)

  const ctx = await ctxA()
  const res = await ctx.get(`/api/nodes/${elena.id}/back-links`)
  expect(res.status()).toBe(200)
  const body = await res.json()
  expect(body.back_links).toHaveLength(2)
  expect(body.total).toBe(2)
  // Ordered by document_name ASC ("A — ..." before "B — ...").
  expect(body.back_links[0].structural_node.document_name).toMatch(/^A —/)
  expect(body.back_links[1].structural_node.document_name).toMatch(/^B —/)
  await ctx.dispose()
})
