// API integration tests for /api/nodes/[nodeId]/move
// Spec: stelavox_phase2_test_plan_v1_0.md TC-A-75 to TC-A-94
//       stelavox_phase2_api_contract_v1_0.md §3.6
// Backed by the move_node RPC (M-021); these tests verify the
// route's wire contract and the RPC's behaviour together.

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

async function setupProject(orgId: string, name = 'TC-A-move project') {
  const { data } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  return data!
}

async function setupNovelDocument(projectId: string, orgId: string, name = 'TC-A-move doc') {
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

test.describe('PATCH /api/nodes/[id]/move', () => {
  let orgA: string
  let project: { id: string }
  let doc: { id: string }
  let rootId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA)
    const setup = await setupNovelDocument(project.id, orgA)
    doc = setup.document
    rootId = setup.root_node.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  // Returns a fresh act under the document root, isolated from prior
  // tests by a random order value far above any sequential allocation.
  async function freshAct(name: string) {
    return insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: rootId, node_type: 'act',
      order: 1000 + Math.floor(Math.random() * 100000),
      depth: 1, layer_index: 1, name,
    })
  }

  async function chapter(parentActId: string, order: number, name: string, locked = false) {
    return insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: parentActId, node_type: 'chapter', order, depth: 2, layer_index: 2, name, locked,
    })
  }

  // ─── happy-path moves ─────────────────────────────────────────────

  test('TC-A-75 within-parent move (Y from order 3 to position 0)', async () => {
    const act = await freshAct('TC-A-75 act')
    const w = await chapter(act.id, 1, 'W')
    const x = await chapter(act.id, 2, 'X')
    const y = await chapter(act.id, 3, 'Y')
    const z = await chapter(act.id, 4, 'Z')

    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${y.id}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.renumbered_count).toBe(3)

    expect((await readNode(y.id))!.order).toBe(1)
    expect((await readNode(w.id))!.order).toBe(2)
    expect((await readNode(x.id))!.order).toBe(3)
    expect((await readNode(z.id))!.order).toBe(4)
    await ctx.dispose()
  })

  test('TC-A-76 cross-parent move (C2 from Act 1 to Act 2)', async () => {
    const act1 = await freshAct('TC-A-76 act1')
    const act2 = await freshAct('TC-A-76 act2')
    const c1 = await chapter(act1.id, 1, 'C1')
    const c2 = await chapter(act1.id, 2, 'C2')
    const c3 = await chapter(act2.id, 1, 'C3')

    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${c2.id}/move`, {
      data: { parent_id: act2.id, position: 1 },
    })
    expect(res.status()).toBe(200)

    expect((await readNode(c2.id))!.parent_id).toBe(act2.id)
    expect((await readNode(c2.id))!.order).toBe(2)
    expect((await readNode(c1.id))!.order).toBe(1)  // alone in act1
    expect((await readNode(c3.id))!.order).toBe(1)  // unchanged in act2
    await ctx.dispose()
  })

  test('TC-A-77 move to first position', async () => {
    const act = await freshAct('TC-A-77 act')
    const a = await chapter(act.id, 1, 'A')
    const b = await chapter(act.id, 2, 'B')
    const c = await chapter(act.id, 3, 'C')

    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${c.id}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(200)
    expect((await readNode(c.id))!.order).toBe(1)
    expect((await readNode(a.id))!.order).toBe(2)
    expect((await readNode(b.id))!.order).toBe(3)
    await ctx.dispose()
  })

  test('TC-A-78 move to last position', async () => {
    const act = await freshAct('TC-A-78 act')
    const a = await chapter(act.id, 1, 'A')
    const b = await chapter(act.id, 2, 'B')
    const c = await chapter(act.id, 3, 'C')

    const ctx = await ctxA()
    // within-parent move: position bounds are [0, child_count - 1]
    // child_count is 3 so max position is 2 (= last)
    const res = await ctx.patch(`/api/nodes/${a.id}/move`, {
      data: { parent_id: act.id, position: 2 },
    })
    expect(res.status()).toBe(200)
    expect((await readNode(a.id))!.order).toBe(3)
    expect((await readNode(b.id))!.order).toBe(1)
    expect((await readNode(c.id))!.order).toBe(2)
    await ctx.dispose()
  })

  test('TC-A-79 no-op move (current position)', async () => {
    const act = await freshAct('TC-A-79 act')
    const a = await chapter(act.id, 1, 'A')
    const b = await chapter(act.id, 2, 'B')
    const c = await chapter(act.id, 3, 'C')

    const beforeUpdated = (await readNode(b.id))!.updated_at

    const ctx = await ctxA()
    // b currently order=2 → position=1 means "second" (order 2). No-op.
    const res = await ctx.patch(`/api/nodes/${b.id}/move`, {
      data: { parent_id: act.id, position: 1 },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Spec allows 0 or 1; M-021 returns 0 for the short-circuit.
    expect([0, 1]).toContain(body.renumbered_count)

    expect((await readNode(a.id))!.order).toBe(1)
    expect((await readNode(b.id))!.order).toBe(2)
    expect((await readNode(c.id))!.order).toBe(3)
    expect((await readNode(b.id))!.updated_at).toBe(beforeUpdated)  // truly unchanged
    await ctx.dispose()
  })

  // ─── tree integrity 422s ──────────────────────────────────────────

  test('TC-A-80 self-cycle → 422 cycle_detected', async () => {
    const act = await freshAct('TC-A-80 act')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${act.id}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('cycle_detected')
    await ctx.dispose()
  })

  test('TC-A-81 descendant cycle → 422 cycle_detected', async () => {
    const act = await freshAct('TC-A-81 act')
    const ch = await chapter(act.id, 1, 'TC-A-81 ch')
    const sc = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: ch.id, node_type: 'scene', order: 1, depth: 3, layer_index: 3, name: 'TC-A-81 scene',
    })
    const ctx = await ctxA()
    // try to move act into one of its descendants (the scene)
    const res = await ctx.patch(`/api/nodes/${act.id}/move`, {
      data: { parent_id: sc.id, position: 0 },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('cycle_detected')
    await ctx.dispose()
  })

  test('TC-A-82 layer_violation → 422', async () => {
    const act = await freshAct('TC-A-82 act')
    const ch = await chapter(act.id, 1, 'TC-A-82 ch')
    const sc = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: ch.id, node_type: 'scene', order: 1, depth: 3, layer_index: 3, name: 'TC-A-82 scene',
    })
    const ctx = await ctxA()
    // move scene under root (root admits only act, not scene)
    const res = await ctx.patch(`/api/nodes/${sc.id}/move`, {
      data: { parent_id: rootId, position: 0 },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('layer_violation')
    await ctx.dispose()
  })

  test('TC-A-83 cross-parent depth recalc preserves descendant depths', async () => {
    const act1 = await freshAct('TC-A-83 act1')
    const act2 = await freshAct('TC-A-83 act2')
    const ch = await chapter(act1.id, 1, 'TC-A-83 ch')
    const sc = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: ch.id, node_type: 'scene', order: 1, depth: 3, layer_index: 3, name: 'sc',
    })
    const beat = await insertNode({
      org_id: orgA, project_id: project.id, document_id: doc.id,
      parent_id: sc.id, node_type: 'beat', order: 1, depth: 4, layer_index: 4, name: 'beat',
    })

    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: act2.id, position: 0 },
    })
    expect(res.status()).toBe(200)

    // Both Act 1 and Act 2 are at depth=1, so the chapter's depth is
    // unchanged; its descendants' depths must also remain correct.
    expect((await readNode(ch.id))!.parent_id).toBe(act2.id)
    expect((await readNode(ch.id))!.depth).toBe(2)
    expect((await readNode(sc.id))!.depth).toBe(3)
    expect((await readNode(beat.id))!.depth).toBe(4)
    await ctx.dispose()
  })

  // ─── 400s on body ─────────────────────────────────────────────────

  test('TC-A-84 position too high → 400 invalid_position', async () => {
    const act = await freshAct('TC-A-84 act')
    await chapter(act.id, 1, 'A')
    await chapter(act.id, 2, 'B')
    const c = await chapter(act.id, 3, 'C')
    const ctx = await ctxA()
    // within-parent: max position is child_count - 1 = 2; 5 is too high
    const res = await ctx.patch(`/api/nodes/${c.id}/move`, {
      data: { parent_id: act.id, position: 5 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_position')
    await ctx.dispose()
  })

  test('TC-A-85 position negative → 400 invalid_position', async () => {
    const act = await freshAct('TC-A-85 act')
    const c = await chapter(act.id, 1, 'C')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${c.id}/move`, {
      data: { parent_id: act.id, position: -1 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_position')
    await ctx.dispose()
  })

  test('TC-A-86 parent in different document → 422 invalid_parent', async () => {
    const d2 = await setupNovelDocument(project.id, orgA, 'TC-A-86 doc2')
    const act = await freshAct('TC-A-86 act')
    const ch = await chapter(act.id, 1, 'TC-A-86 ch')
    const ctx = await ctxA()
    // try to move ch (in doc) under d2.root (different document)
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: d2.root_node.id, position: 0 },
    })
    expect(res.status()).toBe(422)
    expect((await res.json()).error).toBe('invalid_parent')
    await adminClient().from('documents').delete().eq('id', d2.document.id)
    await ctx.dispose()
  })

  test('TC-A-87 missing parent_id → 400 missing_parent_id', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${NULL_UUID}/move`, { data: { position: 0 } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('missing_parent_id')
    await ctx.dispose()
  })

  test('TC-A-88 missing position → 400 invalid_position', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${NULL_UUID}/move`, {
      data: { parent_id: NULL_UUID },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_position')
    await ctx.dispose()
  })

  // ─── 423s on locks ────────────────────────────────────────────────

  test('TC-A-89 locked target node → 423 node_locked', async () => {
    const act = await freshAct('TC-A-89 act')
    const ch = await chapter(act.id, 1, 'TC-A-89 ch', /* locked */ true)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('node_locked')
    await ctx.dispose()
  })

  test('TC-A-90 ancestor of moved node locked → 423 parent_locked', async () => {
    const lockedAct = await freshAct('TC-A-90 locked act')
    await adminClient().from('nodes').update({ locked: true }).eq('id', lockedAct.id)
    const ch = await chapter(lockedAct.id, 1, 'TC-A-90 ch')
    const targetAct = await freshAct('TC-A-90 target')

    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: targetAct.id, position: 0 },
    })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    await ctx.dispose()
  })

  test('TC-A-91 new parent ancestor locked → 423 parent_locked', async () => {
    const sourceAct = await freshAct('TC-A-91 source')
    const lockedTargetAct = await freshAct('TC-A-91 locked target')
    await adminClient().from('nodes').update({ locked: true }).eq('id', lockedTargetAct.id)
    // unlocked chapter under the locked target act — its lineage from
    // that chapter back up includes the locked act.
    const lockedTargetChapter = await chapter(lockedTargetAct.id, 1, 'TC-A-91 locked target ch')
    const ch = await chapter(sourceAct.id, 1, 'TC-A-91 ch')

    const ctx = await ctxA()
    // Move ch (source unlocked) under lockedTargetChapter (whose
    // ancestor lockedTargetAct is locked). We need a layer-valid
    // target: ch is a chapter, so its parent must admit chapters
    // (i.e., an act). Use lockedTargetAct as the new parent.
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: lockedTargetAct.id, position: 0 },
    })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    // touch the unused variable to keep TS happy
    expect(lockedTargetChapter.id).toBeTruthy()
    await ctx.dispose()
  })

  // ─── path/auth ────────────────────────────────────────────────────

  test('TC-A-92 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/not-a-uuid/move`, {
      data: { parent_id: NULL_UUID, position: 0 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-93 not found → 404', async () => {
    const act = await freshAct('TC-A-93 act')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${NULL_UUID}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-94 no session → 401', async () => {
    const act = await freshAct('TC-A-94 act')
    const ch = await chapter(act.id, 1, 'TC-A-94 ch')
    const ctx = await ctxNone()
    const res = await ctx.patch(`/api/nodes/${ch.id}/move`, {
      data: { parent_id: act.id, position: 0 },
    })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})
