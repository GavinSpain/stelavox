// Spec: stelavox_phase3_test_plan_v1_0.md v1.1 §5.5 — TC-A-33..35
//       stelavox_phase3_api_contract_v1_0.md v1.1 §2.12 (is_leaf)
//       stelavox_technical_architecture_v1_6.md H-15

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
    .eq('user_id', user.id).single()
  return data!.organisation_id
}

// Setup helper: create a novel document with the full Book → Act → Chapter →
// Scene → Beat hierarchy, plus a SECOND chapter with no descendants (the
// "in-construction non-leaf with zero children" case for TC-A-34).
async function setupNovelHierarchy(orgId: string, prefix: string) {
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

  async function insert(parent_id: string, node_type: string, depth: number, layer_index: number, name: string, order = 1) {
    const { data } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
      parent_id, node_category: 'structural', node_type, order, depth, layer_index,
      name, status: 'draft', version: 1,
    }).select('id').single()
    return data!.id
  }

  const actId     = await insert(setup.root_node.id, 'act',     1, 1, 'A', 1)
  const chapterId = await insert(actId,              'chapter', 2, 2, 'C', 1)
  const sceneId   = await insert(chapterId,          'scene',   3, 3, 'S', 1)
  const beatId    = await insert(sceneId,            'beat',    4, 4, 'B', 1)
  // Second chapter with no descendants — the "non-leaf with zero children" case.
  const emptyChapterId = await insert(actId, 'chapter', 2, 2, 'EmptyC', 2)

  return {
    projectId: project!.id, documentId: setup.document.id,
    rootId: setup.root_node.id, actId, chapterId, sceneId, beatId,
    emptyChapterId,
  }
}

test.describe('Phase 3 v1.1 — server-derived is_leaf', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-A-33 — GET /api/nodes/[id] returns is_leaf: true for a Beat', async () => {
    const f = await setupNovelHierarchy(orgA, 'TC-A-33')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${f.beatId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.is_leaf).toBe(true)
    expect(body.node.layer_index).toBe(4)
    await adminClient().from('projects').delete().eq('id', f.projectId)
    await ctx.dispose()
  })

  test('TC-A-34 — GET /api/nodes/[id] returns is_leaf: false for a Chapter with NO children', async () => {
    const f = await setupNovelHierarchy(orgA, 'TC-A-34')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/nodes/${f.emptyChapterId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    // Critical: zero children doesn't make it a leaf — TA v1.6 H-15.
    expect(body.node.is_leaf).toBe(false)
    expect(body.node.layer_index).toBe(2)
    // Sanity check: the Chapter we just queried truly has no descendants
    const { count } = await adminClient()
      .from('nodes')
      .select('*', { count: 'exact', head: true })
      .eq('parent_id', f.emptyChapterId)
    expect(count).toBe(0)
    await adminClient().from('projects').delete().eq('id', f.projectId)
    await ctx.dispose()
  })

  test('TC-A-35 — GET /api/documents/[id]/nodes decorates every row with is_leaf', async () => {
    const f = await setupNovelHierarchy(orgA, 'TC-A-35')
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${f.documentId}/nodes`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    const nodes = body.nodes as Array<{ id: string; layer_index: number; is_leaf: boolean }>
    // Every row carries is_leaf
    for (const n of nodes) {
      expect(typeof n.is_leaf).toBe('boolean')
    }
    // Only the deepest-layer rows are true
    const leafNodes = nodes.filter(n => n.is_leaf)
    const nonLeafNodes = nodes.filter(n => !n.is_leaf)
    // Exactly one Beat in the hierarchy → exactly one leaf
    expect(leafNodes).toHaveLength(1)
    expect(leafNodes[0].id).toBe(f.beatId)
    expect(leafNodes[0].layer_index).toBe(4)
    // The empty Chapter is non-leaf despite having no children
    const emptyChapter = nonLeafNodes.find(n => n.id === f.emptyChapterId)
    expect(emptyChapter).toBeDefined()
    expect(emptyChapter!.is_leaf).toBe(false)
    await adminClient().from('projects').delete().eq('id', f.projectId)
    await ctx.dispose()
  })
})
