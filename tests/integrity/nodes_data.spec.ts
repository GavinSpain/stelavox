// Phase 2 data-integrity tests — TC-D-01 through TC-D-12.
// Spec: stelavox_phase2_test_plan_v1_0.md §5.
//
// After every modifying operation, verify nothing else changed:
// orders stay dense, depths recalculate correctly, cycle detection
// rejects without write, root uniqueness, etc. Many tests use the
// service-role admin client to inspect post-state directly.

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
  const user = (users?.users ?? []).find(u => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

async function setupNovelDoc(orgId: string, projectName: string, docName: string) {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: projectName })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id, p_organisation_id: orgId,
    p_name: docName, p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string; root_node_id: string }; root_node: { id: string } }
  return { projectId: project!.id, docId: setup.document.id, rootId: setup.root_node.id }
}

async function insertNode(args: {
  orgId: string; projectId: string; docId: string
  parentId: string; nodeType: string
  order: number; depth: number; layerIndex: number; name: string
}): Promise<string> {
  const { data } = await adminClient()
    .from('nodes')
    .insert({
      organisation_id: args.orgId, project_id: args.projectId, document_id: args.docId,
      parent_id: args.parentId, node_category: 'structural', node_type: args.nodeType,
      order: args.order, depth: args.depth, layer_index: args.layerIndex,
      name: args.name, status: 'draft', version: 1,
    })
    .select('id').single()
  return data!.id
}

test.describe('TC-D-01..12 — Data integrity', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('TC-D-01 sibling order dense after insert', async () => {
    const doc = await setupNovelDoc(orgA, 'D-01 project', 'D-01 doc')
    for (let i = 1; i <= 3; i++) {
      await insertNode({
        orgId: orgA, projectId: doc.projectId, docId: doc.docId,
        parentId: doc.rootId, nodeType: 'act', order: i, depth: 1, layerIndex: 1,
        name: `Act ${i}`,
      })
    }
    // POST a 4th via API (uses createNode helper which assigns order=max+1)
    const ctx = await ctxA()
    const r = await ctx.post(`/api/documents/${doc.docId}/nodes`, {
      data: { parent_id: doc.rootId, node_type: 'act', name: 'Act 4' },
    })
    expect(r.status()).toBe(201)
    const { data: rows } = await adminClient()
      .from('nodes').select('"order"').eq('parent_id', doc.rootId).order('order')
    expect(rows!.map(r => r.order)).toEqual([1, 2, 3, 4])
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-02 sibling order dense after delete (with name preservation)', async () => {
    const doc = await setupNovelDoc(orgA, 'D-02 project', 'D-02 doc')
    const ids: string[] = []
    for (let i = 1; i <= 5; i++) {
      ids.push(await insertNode({
        orgId: orgA, projectId: doc.projectId, docId: doc.docId,
        parentId: doc.rootId, nodeType: 'act', order: i, depth: 1, layerIndex: 1,
        name: `Act-${i}`,
      }))
    }
    const ctx = await ctxA()
    const r = await ctx.delete(`/api/nodes/${ids[2]}`)  // delete the middle
    expect(r.status()).toBe(200)
    const { data: rows } = await adminClient()
      .from('nodes').select('"order", name').eq('parent_id', doc.rootId).order('order')
    expect(rows!.map(r => r.order)).toEqual([1, 2, 3, 4])
    // Names preserved (delete reorders order, not name)
    expect(rows!.map(r => r.name)).toEqual(['Act-1', 'Act-2', 'Act-4', 'Act-5'])
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-03 sibling order dense after within-parent move', async () => {
    const doc = await setupNovelDoc(orgA, 'D-03 project', 'D-03 doc')
    const ids: string[] = []
    for (let i = 1; i <= 4; i++) {
      ids.push(await insertNode({
        orgId: orgA, projectId: doc.projectId, docId: doc.docId,
        parentId: doc.rootId, nodeType: 'act', order: i, depth: 1, layerIndex: 1,
        name: `Act-${i}`,
      }))
    }
    const ctx = await ctxA()
    const r = await ctx.patch(`/api/nodes/${ids[2]}/move`, {  // 3rd to position 0
      data: { parent_id: doc.rootId, position: 0 },
    })
    expect(r.status()).toBe(200)
    const { data: rows } = await adminClient()
      .from('nodes').select('"order"').eq('parent_id', doc.rootId).order('order')
    expect(rows!.map(r => r.order)).toEqual([1, 2, 3, 4])
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-04 sibling order dense on both sides after cross-parent move', async () => {
    const doc = await setupNovelDoc(orgA, 'D-04 project', 'D-04 doc')
    const a1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 1, depth: 1, layerIndex: 1, name: 'Act-Old' })
    const a2 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 2, depth: 1, layerIndex: 1, name: 'Act-New' })
    const cA = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a1, nodeType: 'chapter', order: 1, depth: 2, layerIndex: 2, name: 'A' })
    const cB = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a1, nodeType: 'chapter', order: 2, depth: 2, layerIndex: 2, name: 'B' })
    await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a1, nodeType: 'chapter', order: 3, depth: 2, layerIndex: 2, name: 'C' })
    const cD = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a2, nodeType: 'chapter', order: 1, depth: 2, layerIndex: 2, name: 'D' })
    const cE = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a2, nodeType: 'chapter', order: 2, depth: 2, layerIndex: 2, name: 'E' })

    const ctx = await ctxA()
    const r = await ctx.patch(`/api/nodes/${cB}/move`, {  // move B to a2 position 1
      data: { parent_id: a2, position: 1 },
    })
    expect(r.status()).toBe(200)

    const { data: oldSide } = await adminClient()
      .from('nodes').select('name, "order"').eq('parent_id', a1).order('order')
    expect(oldSide).toEqual([{ name: 'A', order: 1 }, { name: 'C', order: 2 }])

    const { data: newSide } = await adminClient()
      .from('nodes').select('name, "order"').eq('parent_id', a2).order('order')
    expect(newSide).toEqual([{ name: 'D', order: 1 }, { name: 'B', order: 2 }, { name: 'E', order: 3 }])

    // Touch unused vars for ts
    expect([cA, cD, cE].length).toBe(3)
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-05 depth recalc across descendants', async () => {
    const doc = await setupNovelDoc(orgA, 'D-05 project', 'D-05 doc')
    const a1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 1, depth: 1, layerIndex: 1, name: 'Act-1' })
    const a2 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 2, depth: 1, layerIndex: 1, name: 'Act-2' })
    const c1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a1, nodeType: 'chapter', order: 1, depth: 2, layerIndex: 2, name: 'Ch' })
    const s1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: c1, nodeType: 'scene', order: 1, depth: 3, layerIndex: 3, name: 'Sc' })
    const b1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: s1, nodeType: 'beat', order: 1, depth: 4, layerIndex: 4, name: 'Be' })

    const ctx = await ctxA()
    const r = await ctx.patch(`/api/nodes/${c1}/move`, {
      data: { parent_id: a2, position: 0 },
    })
    expect(r.status()).toBe(200)

    const { data: rows } = await adminClient()
      .from('nodes').select('id, depth').in('id', [c1, s1, b1])
    const depthMap = Object.fromEntries(rows!.map(r => [r.id, r.depth]))
    expect(depthMap[c1]).toBe(2)
    expect(depthMap[s1]).toBe(3)
    expect(depthMap[b1]).toBe(4)
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-06 cascade delete count matches descendants_deleted', async () => {
    const doc = await setupNovelDoc(orgA, 'D-06 project', 'D-06 doc')
    const a1 = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 1, depth: 1, layerIndex: 1, name: 'A' })
    // Build subtree: 1 chapter + 3 scenes + 9 beats (1 + 3 + 9 = 13 descendants under a1)
    // Chapter -> 3 scenes; each scene -> 3 beats. Plus a1 itself: target.
    const ch = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a1, nodeType: 'chapter', order: 1, depth: 2, layerIndex: 2, name: 'Ch' })
    for (let i = 1; i <= 3; i++) {
      const sc = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: ch, nodeType: 'scene', order: i, depth: 3, layerIndex: 3, name: `S${i}` })
      for (let j = 1; j <= 3; j++) {
        await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: sc, nodeType: 'beat', order: j, depth: 4, layerIndex: 4, name: `B${i}.${j}` })
      }
    }
    // Total under a1 (excluding a1): 1 chapter + 3 scenes + 9 beats = 13 descendants
    const { count: beforeCount } = await adminClient()
      .from('nodes').select('*', { count: 'exact', head: true }).eq('document_id', doc.docId)

    const ctx = await ctxA()
    const r = await ctx.delete(`/api/nodes/${a1}`)
    expect(r.status()).toBe(200)
    const body = await r.json()
    expect(body.descendants_deleted).toBe(13)

    const { count: afterCount } = await adminClient()
      .from('nodes').select('*', { count: 'exact', head: true }).eq('document_id', doc.docId)
    expect(afterCount).toBe(beforeCount! - 14)  // a1 + 13 descendants
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-07 cycle detection rejects without write', async () => {
    const doc = await setupNovelDoc(orgA, 'D-07 project', 'D-07 doc')
    const a = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 1, depth: 1, layerIndex: 1, name: 'A' })
    const c = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: a, nodeType: 'chapter', order: 1, depth: 2, layerIndex: 2, name: 'C' })
    const s = await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: c, nodeType: 'scene', order: 1, depth: 3, layerIndex: 3, name: 'S' })

    // Snapshot
    const before = await adminClient()
      .from('nodes').select('id, parent_id, "order", depth, updated_at')
      .eq('document_id', doc.docId).order('id')

    const ctx = await ctxA()
    const r = await ctx.patch(`/api/nodes/${a}/move`, {
      data: { parent_id: s, position: 0 },  // try to move A under S (descendant)
    })
    expect(r.status()).toBe(422)
    expect((await r.json()).error).toBe('cycle_detected')

    const after = await adminClient()
      .from('nodes').select('id, parent_id, "order", depth, updated_at')
      .eq('document_id', doc.docId).order('id')
    expect(after.data).toEqual(before.data)

    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-08 root uniqueness invariant', async () => {
    const doc = await setupNovelDoc(orgA, 'D-08 project', 'D-08 doc')
    await insertNode({ orgId: orgA, projectId: doc.projectId, docId: doc.docId, parentId: doc.rootId, nodeType: 'act', order: 1, depth: 1, layerIndex: 1, name: 'A' })
    const { count } = await adminClient()
      .from('nodes').select('*', { count: 'exact', head: true })
      .eq('document_id', doc.docId).is('parent_id', null)
    expect(count).toBe(1)
    await adminClient().from('projects').delete().eq('id', doc.projectId)
  })

  test('TC-D-09 document creation populates root_node_id atomically', async () => {
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects').insert({ organisation_id: orgA, name: 'D-09 project' }).select('id').single()
    const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: project!.id, p_organisation_id: orgA,
      p_name: 'D-09 doc', p_description: null as unknown as string,
      p_document_type: 'novel', p_authors: [],
    })
    const setup = rpc as { document: { id: string; root_node_id: string }; root_node: { id: string } }
    expect(setup.document.root_node_id).toBe(setup.root_node.id)
    // Re-read documents row to confirm root_node_id is committed (not transient)
    const { data: docRow } = await admin
      .from('documents').select('root_node_id').eq('id', setup.document.id).single()
    expect(docRow!.root_node_id).toBe(setup.root_node.id)
    await admin.from('projects').delete().eq('id', project!.id)
  })

  test('TC-D-10 failed POST leaves no orphans', async () => {
    const doc = await setupNovelDoc(orgA, 'D-10 project', 'D-10 doc')
    const { count: beforeCount } = await adminClient()
      .from('nodes').select('*', { count: 'exact', head: true }).eq('document_id', doc.docId)

    const ctx = await ctxA()
    // POST scene under root — layer violation (root admits acts)
    const r = await ctx.post(`/api/documents/${doc.docId}/nodes`, {
      data: { parent_id: doc.rootId, node_type: 'scene', name: 'X' },
    })
    expect(r.status()).toBe(422)
    expect((await r.json()).error).toBe('layer_violation')

    const { count: afterCount } = await adminClient()
      .from('nodes').select('*', { count: 'exact', head: true }).eq('document_id', doc.docId)
    expect(afterCount).toBe(beforeCount)
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-11 locked-node PATCH does not bump updated_at', async () => {
    const doc = await setupNovelDoc(orgA, 'D-11 project', 'D-11 doc')
    const { data: act } = await adminClient()
      .from('nodes')
      .insert({
        organisation_id: orgA, project_id: doc.projectId, document_id: doc.docId,
        parent_id: doc.rootId, node_category: 'structural', node_type: 'act',
        order: 1, depth: 1, layer_index: 1, name: 'L', locked: true,
        status: 'draft', version: 1,
      })
      .select('id, updated_at').single()
    const before = act!.updated_at

    const ctx = await ctxA()
    const r = await ctx.patch(`/api/nodes/${act!.id}`, { data: { name: 'Hijacked' } })
    expect(r.status()).toBe(423)

    const { data: after } = await adminClient()
      .from('nodes').select('updated_at').eq('id', act!.id).single()
    expect(after!.updated_at).toBe(before)
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })

  test('TC-D-12 concurrent reorders produce dense ordering', async () => {
    const doc = await setupNovelDoc(orgA, 'D-12 project', 'D-12 doc')
    const ids: string[] = []
    for (let i = 1; i <= 5; i++) {
      ids.push(await insertNode({
        orgId: orgA, projectId: doc.projectId, docId: doc.docId,
        parentId: doc.rootId, nodeType: 'act', order: i, depth: 1, layerIndex: 1,
        name: `Act-${i}`,
      }))
    }

    const ctx = await ctxA()
    // Two concurrent moves
    const [r1, r2] = await Promise.all([
      ctx.patch(`/api/nodes/${ids[2]}/move`, { data: { parent_id: doc.rootId, position: 0 } }),
      ctx.patch(`/api/nodes/${ids[3]}/move`, { data: { parent_id: doc.rootId, position: 1 } }),
    ])
    expect(r1.status()).toBe(200)
    expect(r2.status()).toBe(200)

    const { data: rows } = await adminClient()
      .from('nodes').select('"order"').eq('parent_id', doc.rootId).order('order')
    // Final orders must be dense 1..5 — exact node positions are implementation-dependent
    expect(rows!.map(r => r.order)).toEqual([1, 2, 3, 4, 5])
    await adminClient().from('projects').delete().eq('id', doc.projectId)
    await ctx.dispose()
  })
})
