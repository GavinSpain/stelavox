// API integration tests for /api/nodes/[nodeId] (GET / PATCH / DELETE)
// Spec: stelavox_phase2_test_plan_v1_0.md TC-A-34 to TC-A-74
//       stelavox_phase2_api_contract_v1_0.md §3.3, §3.4, §3.5

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

async function setupProject(orgId: string, name = 'TC-A single nodes-project') {
  const { data } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  return data!
}

async function setupNovelDocument(projectId: string, orgId: string, name = 'TC-A single doc') {
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
  id: string; parent_id: string; order: number; depth: number; layer_index: number; node_type: string
}

async function insertNode(args: {
  org_id: string; project_id: string; document_id: string
  parent_id: string; node_type: string
  order: number; depth: number; layer_index: number
  name?: string; locked?: boolean
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
      locked:          args.locked ?? false,
      status:          'draft',
      version:         1,
    })
    .select('id, parent_id, order, depth, layer_index, node_type')
    .single()
  return data as ChildNode
}

async function readNode(id: string) {
  const { data } = await adminClient().from('nodes').select('*').eq('id', id).maybeSingle()
  return data
}

async function setLocked(id: string, locked: boolean) {
  await adminClient().from('nodes').update({ locked }).eq('id', id)
}

// ─── GET /api/nodes/[id] ────────────────────────────────────────────────────

test.describe('GET /api/nodes/[id]', () => {
  let orgA: string
  let project: { id: string }
  let doc: { id: string }
  let act: ChildNode

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-GET single project')
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-GET single doc')
    doc = setup.document
    act = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: setup.root_node.id, node_type: 'act',
      order: 1, depth: 1, layer_index: 1, name: 'Act 1',
    })
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-34 happy path', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${act.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.id).toBe(act.id)
    expect(body.node.node_type).toBe('act')
    expect(body.node.depth).toBe(1)
    expect(body.node.layer_index).toBe(1)
    await ctx.dispose()
  })

  test('TC-A-35 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/not-a-uuid`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-36 not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-37 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/nodes/${act.id}`)
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})

// ─── PATCH /api/nodes/[id] ──────────────────────────────────────────────────

test.describe('PATCH /api/nodes/[id]', () => {
  let orgA: string
  let project: { id: string }
  let doc: { id: string }
  let rootId: string
  let actId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-PATCH project')
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-PATCH doc')
    doc = setup.document
    rootId = setup.root_node.id
    const act = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act', order: 1, depth: 1, layer_index: 1, name: 'Act',
    })
    actId = act.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  // Each test gets its own chapter to isolate state.
  async function freshChapter(name: string) {
    return insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: actId, node_type: 'chapter', order: Math.floor(Math.random() * 10000),
      depth: 2, layer_index: 2, name,
    })
  }

  test('TC-A-38 rename', async () => {
    const ch = await freshChapter('TC-A-38')
    const before = await readNode(ch.id)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'Renamed' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.name).toBe('Renamed')
    expect(body.node.version).toBe(before!.version)
    expect(body.node.updated_at).not.toBe(before!.updated_at)
    await ctx.dispose()
  })

  test('TC-A-39 status draft → in_review', async () => {
    const ch = await freshChapter('TC-A-39')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { status: 'in_review' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.status).toBe('in_review')
    await ctx.dispose()
  })

  test('TC-A-40 status draft → approved', async () => {
    const ch = await freshChapter('TC-A-40')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { status: 'approved' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.status).toBe('approved')
    await ctx.dispose()
  })

  test('TC-A-41 status draft → locked (status only, not boolean)', async () => {
    const ch = await freshChapter('TC-A-41')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { status: 'locked' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.status).toBe('locked')
    expect(body.node.locked).toBe(false)  // status='locked' does not set the locked boolean
    await ctx.dispose()
  })

  test('TC-A-42 set agent_instruction', async () => {
    const ch = await freshChapter('TC-A-42')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { agent_instruction: 'Do thing.' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.agent_instruction).toBe('Do thing.')
    expect(body.node.version).toBe(1)
    await ctx.dispose()
  })

  test('TC-A-43 set word_count_target', async () => {
    const ch = await freshChapter('TC-A-43')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { word_count_target: 4000 } })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.word_count_target).toBe(4000)
    await ctx.dispose()
  })

  test('TC-A-44 set summary bumps version 1 → 2', async () => {
    const ch = await freshChapter('TC-A-44')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { summary: 'A summary.' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.summary).toBe('A summary.')
    expect(body.node.version).toBe(2)
    await ctx.dispose()
  })

  test('TC-A-45 set prose bumps version', async () => {
    const ch = await freshChapter('TC-A-45')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { prose: 'Prose.' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(2)
    await ctx.dispose()
  })

  test('TC-A-46 mixed rename + summary bumps version once', async () => {
    const ch = await freshChapter('TC-A-46')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, {
      data: { name: 'X', summary: 'Y' },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.name).toBe('X')
    expect(body.node.summary).toBe('Y')
    expect(body.node.version).toBe(2)  // exactly +1
    await ctx.dispose()
  })

  test('TC-A-47 rename-only twice does not bump version', async () => {
    const ch = await freshChapter('TC-A-47')
    const ctx = await ctxA()
    await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'A' } })
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'B' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(1)
    await ctx.dispose()
  })

  // Forbidden-field 400s — TC-A-48..55 in one parameterised loop
  for (const field of [
    'parent_id', 'node_type', 'order', 'depth', 'id', 'organisation_id',
    'node_category', 'mobile_notes',
  ]) {
    test(`forbidden field "${field}" → 400 unknown_field`, async () => {
      const ch = await freshChapter(`TC-A-forbidden-${field}`)
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { [field]: 'anything' } })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('unknown_field')
      expect(body.message).toContain(field)
      await ctx.dispose()
    })
  }

  test('TC-A-56 invalid status → 400', async () => {
    const ch = await freshChapter('TC-A-56')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { status: 'completed' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_status')
    await ctx.dispose()
  })

  test('TC-A-57 empty body → 400 empty_update', async () => {
    const ch = await freshChapter('TC-A-57')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: {} })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('empty_update')
    await ctx.dispose()
  })

  test('TC-A-58 prose >1M chars → 400 invalid_prose', async () => {
    const ch = await freshChapter('TC-A-58')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { prose: 'a'.repeat(1_000_001) } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_prose')
    await ctx.dispose()
  })

  test('TC-A-59 locked node → 423 node_locked', async () => {
    const ch = await freshChapter('TC-A-59')
    await setLocked(ch.id, true)
    const before = await readNode(ch.id)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'Hijacked' } })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('node_locked')
    const after = await readNode(ch.id)
    expect(after!.name).toBe(before!.name)
    expect(after!.updated_at).toBe(before!.updated_at)
    await ctx.dispose()
  })

  test('TC-A-60 ancestor locked → 423 parent_locked', async () => {
    const lockedAct = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act', order: 999, depth: 1, layer_index: 1,
      name: 'TC-A-60 locked act', locked: true,
    })
    const ch = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: lockedAct.id, node_type: 'chapter', order: 1, depth: 2, layer_index: 2,
      name: 'TC-A-60 chapter',
    })
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'X' } })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    await ctx.dispose()
  })

  test('TC-A-61 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/not-a-uuid`, { data: { name: 'X' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-62 not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${NULL_UUID}`, { data: { name: 'X' } })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-63 no session → 401', async () => {
    const ch = await freshChapter('TC-A-63')
    const ctx = await ctxNone()
    const res = await ctx.patch(`/api/nodes/${ch.id}`, { data: { name: 'X' } })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})

// ─── DELETE /api/nodes/[id] ─────────────────────────────────────────────────

test.describe('DELETE /api/nodes/[id]', () => {
  let orgA: string
  let project: { id: string }
  let doc: { id: string }
  let rootId: string
  let actId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-DELETE project')
    const setup = await setupNovelDocument(project.id, orgA, 'TC-A-DELETE doc')
    doc = setup.document
    rootId = setup.root_node.id
    const act = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act', order: 1, depth: 1, layer_index: 1, name: 'Act',
    })
    actId = act.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  async function freshChapter(name: string, order = Math.floor(Math.random() * 10000)) {
    return insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: actId, node_type: 'chapter', order, depth: 2, layer_index: 2, name,
    })
  }

  test('TC-A-64 happy: leaf node', async () => {
    const ch = await freshChapter('TC-A-64')
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
    expect(body.node_id).toBe(ch.id)
    expect(body.descendants_deleted).toBe(0)
    const after = await readNode(ch.id)
    expect(after).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-65 cascade with descendants (1 chapter + 3 scenes + 6 beats = 9 desc)', async () => {
    const ch = await freshChapter('TC-A-65')
    for (let s = 1; s <= 3; s++) {
      const scene = await insertNode({
        org_id: orgA, project_id: project.id, document_id: doc.id,
        parent_id: ch.id, node_type: 'scene', order: s, depth: 3, layer_index: 3,
        name: `S${s}`,
      })
      for (let b = 1; b <= 2; b++) {
        await insertNode({
          org_id: orgA, project_id: project.id, document_id: doc.id,
          parent_id: scene.id, node_type: 'beat', order: b, depth: 4, layer_index: 4,
          name: `B${s}.${b}`,
        })
      }
    }
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.descendants_deleted).toBe(9)
    expect(await readNode(ch.id)).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-66 sibling renumber after delete (1,2,3,4 → 1,_,2,3)', async () => {
    // Use a fresh act to get isolated siblings
    const isoAct = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act', order: 99, depth: 1, layer_index: 1, name: 'TC-A-66 act',
    })
    const c1 = await insertNode({ org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: isoAct.id, node_type: 'chapter', order: 1, depth: 2, layer_index: 2, name: 'C1' })
    const c2 = await insertNode({ org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: isoAct.id, node_type: 'chapter', order: 2, depth: 2, layer_index: 2, name: 'C2' })
    const c3 = await insertNode({ org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: isoAct.id, node_type: 'chapter', order: 3, depth: 2, layer_index: 2, name: 'C3' })
    const c4 = await insertNode({ org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: isoAct.id, node_type: 'chapter', order: 4, depth: 2, layer_index: 2, name: 'C4' })

    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${c2.id}`)
    expect(res.status()).toBe(200)

    expect((await readNode(c1.id))!.order).toBe(1)
    expect((await readNode(c3.id))!.order).toBe(2)
    expect((await readNode(c4.id))!.order).toBe(3)
    expect(await readNode(c2.id)).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-67 cannot delete root → 422', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${rootId}`)
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('cannot_delete_root')
    expect(await readNode(rootId)).not.toBeNull()
    await ctx.dispose()
  })

  test('TC-A-68 body must be empty → 400 unexpected_body', async () => {
    const ch = await freshChapter('TC-A-68')
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${ch.id}`, {
      headers: { 'content-type': 'application/json' },
      data: { force: true },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unexpected_body')
    expect(await readNode(ch.id)).not.toBeNull()
    await ctx.dispose()
  })

  test('TC-A-69 locked node → 423 node_locked', async () => {
    const ch = await freshChapter('TC-A-69')
    await setLocked(ch.id, true)
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('node_locked')
    expect(await readNode(ch.id)).not.toBeNull()
    await ctx.dispose()
  })

  test('TC-A-70 ancestor locked → 423 parent_locked', async () => {
    const lockedAct = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act', order: 998, depth: 1, layer_index: 1,
      name: 'TC-A-70 locked act', locked: true,
    })
    const ch = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: lockedAct.id, node_type: 'chapter', order: 1, depth: 2, layer_index: 2,
      name: 'TC-A-70 chapter',
    })
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    expect(await readNode(ch.id)).not.toBeNull()
    await ctx.dispose()
  })

  test('TC-A-71 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/not-a-uuid`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-72 not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/nodes/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-73 second DELETE → 404', async () => {
    const ch = await freshChapter('TC-A-73')
    const ctx = await ctxA()
    const r1 = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(r1.status()).toBe(200)
    const r2 = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(r2.status()).toBe(404)
    expect((await r2.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-74 no session → 401', async () => {
    const ch = await freshChapter('TC-A-74')
    const ctx = await ctxNone()
    const res = await ctx.delete(`/api/nodes/${ch.id}`)
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})
