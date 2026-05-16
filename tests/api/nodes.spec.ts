// API integration tests for /api/documents/[documentId]/nodes
// Spec: stelavox_phase2_test_plan_v1_0.md TC-A-01 to TC-A-33
//       stelavox_phase2_api_contract_v1_0.md §3.1 (POST), §3.2 (GET list)
//
// Mirrors tests/api/documents.spec.ts patterns: Playwright `request`
// contexts with stored auth state, adminClient() for setup/teardown
// via service role.

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'
const NULL_UUID = '00000000-0000-0000-0000-000000000000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}
async function ctxNone() {
  return request.newContext({ baseURL: BASE })
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

async function setupProject(orgId: string, name = 'TC-A nodes-project') {
  const { data } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  return data!
}

async function setupNovelDocument(
  projectId: string,
  orgId: string,
  name = 'TC-A nodes-doc',
) {
  const { data } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id:      projectId,
    p_organisation_id: orgId,
    p_name:            name,
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  return data as {
    document:    { id: string; root_node_id: string }
    layer_stack: { id: string; layers: unknown }
    root_node:   { id: string }
  }
}

interface ChildNode {
  id: string
  parent_id: string
  order: number
  depth: number
  layer_index: number
  node_type: string
}

async function insertNode(args: {
  org_id:        string
  project_id:    string
  document_id:   string
  parent_id:     string
  node_type:     string
  order:         number
  depth:         number
  layer_index:   number
  name?:         string
  locked?:       boolean
}): Promise<ChildNode> {
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
      name:            args.name ?? null,
      status:          'draft',
      version:         1,
    })
    .select('id, parent_id, order, depth, layer_index, node_type')
    .single()
  const node = data as ChildNode

  if (args.locked) {
    // Phase 6: nodes.locked dropped — use node_author_locks instead.
    const { data: member } = await adminClient()
      .from('organisation_members')
      .select('user_id')
      .eq('organisation_id', args.org_id)
      .limit(1)
      .single()
    if (member?.user_id) {
      await adminClient().from('node_author_locks').insert({
        node_id: node.id,
        organisation_id: args.org_id,
        locked_by_user_id: member.user_id,
        lock_reason: 'test fixture',
      })
    }
  }
  return node
}

// ─── POST /api/documents/[id]/nodes ─────────────────────────────────────────

test.describe('POST /api/documents/[id]/nodes', () => {
  let orgA: string
  let project: { id: string }
  let doc: { id: string }
  let rootNode: { id: string }
  let actNode: ChildNode

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA)
    const setup = await setupNovelDocument(project.id, orgA)
    doc = setup.document
    rootNode = setup.root_node
    actNode = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootNode.id,
      node_type: 'act', order: 1, depth: 1, layer_index: 1, name: 'Act 1',
    })
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-01 happy: chapter under act', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'Chapter 1' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.node.parent_id).toBe(actNode.id)
    expect(body.node.node_type).toBe('chapter')
    expect(body.node.node_category).toBe('structural')
    expect(body.node.layer_index).toBe(2)
    expect(body.node.depth).toBe(2)
    expect(body.node.order).toBe(1)
    expect(body.node.status).toBe('draft')
    expect(body.node.version).toBe(1)
    await ctx.dispose()
  })

  test('TC-A-02 happy: all optional fields', async () => {
    const ctx = await ctxA()
    // create a chapter to use as scene parent
    const chapterRes = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'Ch for scene' },
    })
    const chapter = (await chapterRes.json()).node
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: {
        parent_id: chapter.id, node_type: 'scene', name: 'Scene 1',
        short_description: 'Opening',
        agent_instruction: 'Introduce protagonist.',
        word_count_target: 1500,
      },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.node.layer_index).toBe(3)
    expect(body.node.depth).toBe(3)
    expect(body.node.short_description).toBe('Opening')
    expect(body.node.agent_instruction).toBe('Introduce protagonist.')
    expect(body.node.word_count_target).toBe(1500)
    await ctx.dispose()
  })

  test('TC-A-03 order auto-assigned (append)', async () => {
    const ctx = await ctxA()
    // create a fresh chapter parent so siblings don't collide
    const chRes = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'Order parent' },
    })
    const ch = (await chRes.json()).node
    const r1 = await ctx.post(`/api/documents/${doc.id}/nodes`, { data: { parent_id: ch.id, node_type: 'scene', name: 'S1' } })
    const r2 = await ctx.post(`/api/documents/${doc.id}/nodes`, { data: { parent_id: ch.id, node_type: 'scene', name: 'S2' } })
    const r3 = await ctx.post(`/api/documents/${doc.id}/nodes`, { data: { parent_id: ch.id, node_type: 'scene', name: 'S3' } })
    expect((await r1.json()).node.order).toBe(1)
    expect((await r2.json()).node.order).toBe(2)
    expect((await r3.json()).node.order).toBe(3)
    await ctx.dispose()
  })

  test('TC-A-04 node_category defaults to structural', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'Default cat' },
    })
    expect(res.status()).toBe(201)
    expect((await res.json()).node.node_category).toBe('structural')
    await ctx.dispose()
  })

  test('TC-A-05 node_category="context" → 400 invalid_category', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', node_category: 'context', name: 'X' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_category')
    await ctx.dispose()
  })

  test('TC-A-06 invalid documentId UUID → 400 invalid_uuid', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/not-a-uuid/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-07 empty body → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, { data: {} })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(['missing_parent_id', 'missing_body']).toContain(body.error)
    await ctx.dispose()
  })

  test('TC-A-08 unknown field → 400 unknown_field', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', depth: 5 },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('unknown_field')
    expect(body.message).toContain('depth')
    await ctx.dispose()
  })

  test('TC-A-09 missing parent_id → 400 missing_parent_id', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { node_type: 'chapter', name: 'X' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('missing_parent_id')
    await ctx.dispose()
  })

  test('TC-A-10 missing node_type → 400 invalid_node_type', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, name: 'X' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_node_type')
    await ctx.dispose()
  })

  test('TC-A-11 empty node_type → 400 invalid_node_type', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: '   ', name: 'X' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_node_type')
    await ctx.dispose()
  })

  test('TC-A-12 name >200 chars → 400 invalid_name', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'a'.repeat(201) },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_name')
    await ctx.dispose()
  })

  test('TC-A-13 short_description >1000 → 400 invalid_short_description', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: {
        parent_id: actNode.id, node_type: 'chapter', name: 'X',
        short_description: 'a'.repeat(1001),
      },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_short_description')
    await ctx.dispose()
  })

  test('TC-A-14 word_count_target negative → 400 invalid_word_count_target', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter', name: 'X', word_count_target: -1 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_word_count_target')
    await ctx.dispose()
  })

  test('TC-A-15 document not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${NULL_UUID}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter' },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('document_not_found')
    await ctx.dispose()
  })

  test('TC-A-16 parent in different document → 422 invalid_parent', async () => {
    const ctx = await ctxA()
    // Build a second doc D2 and try to use D1's act as parent
    const d2 = await setupNovelDocument(project.id, orgA, 'TC-A-16 doc')
    const res = await ctx.post(`/api/documents/${d2.document.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter' },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('invalid_parent')
    await adminClient().from('documents').delete().eq('id', d2.document.id)
    await ctx.dispose()
  })

  test('TC-A-17 parent does not exist → 422 invalid_parent', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: NULL_UUID, node_type: 'chapter' },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('invalid_parent')
    await ctx.dispose()
  })

  test('TC-A-18 layer_violation', async () => {
    const ctx = await ctxA()
    // POST scene under root (root admits act, not scene)
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: rootNode.id, node_type: 'scene', name: 'X' },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('layer_violation')
    await ctx.dispose()
  })

  test('TC-A-19 max_depth_exceeded', async () => {
    const ctx = await ctxA()
    // Build chain: act → chapter → scene → beat. Then POST under beat.
    const chapter = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: actNode.id, node_type: 'chapter', order: 99,
      depth: 2, layer_index: 2, name: 'TC-A-19 chapter',
    })
    const scene = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: chapter.id, node_type: 'scene', order: 1,
      depth: 3, layer_index: 3, name: 'TC-A-19 scene',
    })
    const beat = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: scene.id, node_type: 'beat', order: 1,
      depth: 4, layer_index: 4, name: 'TC-A-19 beat',
    })
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: beat.id, node_type: 'beat', name: 'X' },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('max_depth_exceeded')
    await ctx.dispose()
  })

  test('TC-A-20 parent locked → 423', async () => {
    const ctx = await ctxA()
    // Create an act, lock it, attempt to create a chapter under it
    const lockedAct = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootNode.id, node_type: 'act', order: 99,
      depth: 1, layer_index: 1, name: 'TC-A-20 act', locked: true,
    })
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: lockedAct.id, node_type: 'chapter' },
    })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    await ctx.dispose()
  })

  test.skip('TC-A-21 ancestor locked → 423 — SUPERSEDED Phase 6 D2', async () => {
    // Phase 6 D2: locks are per-node with NO implicit cascade. Locking
    // an ancestor doesn't propagate. A child of a locked ancestor that
    // is itself unlocked accepts new descendants. This test asserted
    // the old cascade semantics that Phase 6.A removed (ancestorChainLocked
    // helper dropped from all routes).
  })

  test('TC-A-22 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      data: { parent_id: actNode.id, node_type: 'chapter' },
    })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })

  test('TC-A-23 Content-Type not JSON → 400 invalid_json', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/documents/${doc.id}/nodes`, {
      headers: { 'content-type': 'text/plain' },
      data: '{"parent_id":"' + actNode.id + '","node_type":"chapter"}',
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
    await ctx.dispose()
  })
})

// ─── GET /api/documents/[id]/nodes ──────────────────────────────────────────

test.describe('GET /api/documents/[id]/nodes', () => {
  let orgA: string
  let project: { id: string }

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-GET project')
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  async function buildSmallTree(docName: string) {
    const setup = await setupNovelDocument(project.id, orgA, docName)
    const docId = setup.document.id
    const root = setup.root_node
    // Tree: root → A (order 1) → C1, C2 ; root → B (order 2)
    // Plus a couple deeper for TC-A-24's "10 nodes total" target.
    const a = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: root.id, node_type: 'act', order: 1, depth: 1, layer_index: 1, name: 'A',
    })
    const b = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: root.id, node_type: 'act', order: 2, depth: 1, layer_index: 1, name: 'B',
    })
    const c1 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: a.id, node_type: 'chapter', order: 1, depth: 2, layer_index: 2, name: 'A.C1',
    })
    const c2 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: a.id, node_type: 'chapter', order: 2, depth: 2, layer_index: 2, name: 'A.C2',
    })
    const c3 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: b.id, node_type: 'chapter', order: 1, depth: 2, layer_index: 2, name: 'B.C3',
    })
    const s1 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: c1.id, node_type: 'scene', order: 1, depth: 3, layer_index: 3, name: 'A.C1.S1',
    })
    const s2 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: c1.id, node_type: 'scene', order: 2, depth: 3, layer_index: 3, name: 'A.C1.S2',
    })
    const s3 = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: c3.id, node_type: 'scene', order: 1, depth: 3, layer_index: 3, name: 'B.C3.S3',
    })
    const beat = await insertNode({
      org_id: orgA, project_id: project.id, document_id: docId,
      parent_id: s1.id, node_type: 'beat', order: 1, depth: 4, layer_index: 4, name: 'A.C1.S1.B1',
    })
    return { docId, root: root.id, a: a.id, b: b.id, c1: c1.id, c2: c2.id, c3: c3.id, s1: s1.id, s2: s2.id, s3: s3.id, beat: beat.id }
  }

  test('TC-A-24 happy: small tree → 200', async () => {
    const t = await buildSmallTree('TC-A-24 doc')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${t.docId}/nodes`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.nodes).toHaveLength(10)
    await ctx.dispose()
  })

  test('TC-A-25 happy: just root → 200, length 1', async () => {
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-25 doc')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${setup.document.id}/nodes`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.nodes).toHaveLength(1)
    expect(body.nodes[0].parent_id).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-26 depth-first ordering verified', async () => {
    const t = await buildSmallTree('TC-A-26 doc')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${t.docId}/nodes`)
    expect(res.status()).toBe(200)
    const ids = (await res.json()).nodes.map((n: { id: string }) => n.id)
    // Root first; then A and its full subtree (C1, S1, beat, S2; C2);
    // then B and its full subtree (C3, S3).
    expect(ids).toEqual([
      t.root, t.a, t.c1, t.s1, t.beat, t.s2, t.c2, t.b, t.c3, t.s3,
    ])
    await ctx.dispose()
  })

  test('TC-A-27 ?category=structural matches default', async () => {
    const t = await buildSmallTree('TC-A-27 doc')
    const ctx = await ctxA()
    const r1 = await ctx.get(`/api/documents/${t.docId}/nodes`)
    const r2 = await ctx.get(`/api/documents/${t.docId}/nodes?category=structural`)
    expect(r1.status()).toBe(200)
    expect(r2.status()).toBe(200)
    expect(await r1.json()).toEqual(await r2.json())
    await ctx.dispose()
  })

  test('TC-A-28 ?category=context returns 0 rows in Phase 2', async () => {
    const t = await buildSmallTree('TC-A-28 doc')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${t.docId}/nodes?category=context`)
    expect(res.status()).toBe(200)
    expect((await res.json()).nodes).toHaveLength(0)
    await ctx.dispose()
  })

  test('TC-A-29 ?category=all returns same as structural in Phase 2', async () => {
    const t = await buildSmallTree('TC-A-29 doc')
    const ctx = await ctxA()
    const r1 = await ctx.get(`/api/documents/${t.docId}/nodes?category=structural`)
    const r2 = await ctx.get(`/api/documents/${t.docId}/nodes?category=all`)
    expect(r1.status()).toBe(200)
    expect(r2.status()).toBe(200)
    expect((await r1.json()).nodes).toHaveLength((await r2.json()).nodes.length)
    await ctx.dispose()
  })

  test('TC-A-30 unknown query param → 400 unknown_param', async () => {
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-30 doc')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${setup.document.id}/nodes?include_locked=true`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_param')
    await ctx.dispose()
  })

  test('TC-A-31 invalid documentId UUID → 400 invalid_uuid', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/not-a-uuid/nodes`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-32 document not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${NULL_UUID}/nodes`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('document_not_found')
    await ctx.dispose()
  })

  test('TC-A-33 no session → 401', async () => {
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-33 doc')
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/documents/${setup.document.id}/nodes`)
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})
