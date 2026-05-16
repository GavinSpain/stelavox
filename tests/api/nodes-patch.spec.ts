// Spec: stelavox_phase3_test_plan_v1_0.md §5.1 — TC-A-01..16, TC-A-30..32
//       stelavox_phase3_api_contract_v1_0.md §3.1 (PATCH with expected_version)

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

async function setupBeat(orgId: string, prefix = 'TC-A') {
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
  // Insert chapter → scene → beat for full hierarchy
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
  return { projectId: project!.id, beatId: beat!.id, chapterId: chapter!.id }
}

async function readNode(id: string) {
  const { data } = await adminClient().from('nodes').select('*').eq('id', id).maybeSingle()
  return data
}

async function setLocked(id: string, locked: boolean) {
  // Phase 6: nodes.locked dropped; use node_author_locks.
  if (locked) {
    const { data: node } = await adminClient()
      .from('nodes').select('organisation_id').eq('id', id).single()
    const { data: member } = await adminClient()
      .from('organisation_members').select('user_id')
      .eq('organisation_id', node!.organisation_id).limit(1).single()
    await adminClient().from('node_author_locks').insert({
      node_id: id, organisation_id: node!.organisation_id,
      locked_by_user_id: member!.user_id, lock_reason: 'test',
    })
  } else {
    await adminClient().from('node_author_locks').delete().eq('node_id', id)
  }
}

async function bumpVersionViaService(id: string, fields: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await adminClient().from('nodes').update(fields as any).eq('id', id)
}

test.describe('Phase 3 — PATCH /api/nodes/[id] concurrency', () => {
  let orgA: string

  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-A-01 — PATCH with no expected_version succeeds (Phase 2 back-compat)', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-01')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('hello') },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.node.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-02 — PATCH with matching expected_version succeeds', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-02')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), expected_version: 1 },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-03 — PATCH with stale expected_version returns 409 with current', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-03')
    // Bump to v=3 via service role (simulating another writer)
    await bumpVersionViaService(beatId, { prose: tiptapDoc('first-bump') })
    await bumpVersionViaService(beatId, { prose: tiptapDoc('second-bump') })
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('mine'), expected_version: 1 },
    })
    expect(res.status()).toBe(409)
    const body = await res.json()
    expect(body.error).toBe('version_conflict')
    expect(body.current).toBeDefined()
    expect(body.current.version).toBe(3)
    expect(body.current.prose).toBe(tiptapDoc('second-bump'))
    // DB unchanged
    const after = await readNode(beatId)
    expect(after!.version).toBe(3)
    expect(after!.prose).toBe(tiptapDoc('second-bump'))
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-04 — PATCH with future expected_version returns 409', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-04')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), expected_version: 99 },
    })
    expect(res.status()).toBe(409)
    expect((await res.json()).error).toBe('version_conflict')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-05 — expected_version = 0 returns 400 invalid_expected_version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-05')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), expected_version: 0 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_expected_version')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-06 — Non-integer expected_version returns 400 invalid_expected_version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-06')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { expected_version: '1' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_expected_version')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-07 — version field on body returns 400 unknown_field', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-07')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), version: 5 },
    })
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('unknown_field')
    expect(body.message).toContain('version')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-08 — Renaming does not bump version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-08')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { name: 'new', expected_version: 1 },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(1)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-09 — Name + prose bumps version exactly once', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-09')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { name: 'new', prose: tiptapDoc('x'), expected_version: 1 },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-10 — Metadata-only change bumps version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-10')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { metadata: { k: 'v' }, expected_version: 1 },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-11 — Same content does not bump version (IS DISTINCT FROM)', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-11')
    // Set initial prose
    await adminClient().from('nodes').update({ prose: tiptapDoc('x') }).eq('id', beatId)
    const before = await readNode(beatId)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x'), expected_version: before!.version },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(before!.version)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-12 — Locked node returns 423 (beats 409)', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-12')
    await bumpVersionViaService(beatId, { prose: tiptapDoc('a') })
    await bumpVersionViaService(beatId, { prose: tiptapDoc('b') })
    await setLocked(beatId, true)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('mine'), expected_version: 1 },
    })
    expect(res.status()).toBe(423)
    const body = await res.json()
    expect(body.error).toBe('node_locked')
    expect(body.current).toBeUndefined()  // 423 path does NOT include current
    await setLocked(beatId, false)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-13 — Setting content field to null bumps version', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-13')
    await adminClient().from('nodes').update({ summary: tiptapDoc('x') }).eq('id', beatId)
    const before = await readNode(beatId)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { summary: null, expected_version: before!.version },
    })
    expect(res.status()).toBe(200)
    expect((await res.json()).node.version).toBe(before!.version + 1)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-14 — Body with only expected_version returns 400 missing_body', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-14')
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { expected_version: 1 },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('missing_body')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-15 — PATCH on non-existent node returns 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/00000000-0000-0000-0000-000000000000`, {
      data: { prose: tiptapDoc('x') },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    await ctx.dispose()
  })

  test('TC-A-16 — Prose exceeding 2,000,000 chars returns 400 invalid_prose', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-16')
    const ctx = await ctxA()
    const big = 'a'.repeat(2_000_001)
    const res = await ctx.patch(`/api/nodes/${beatId}`, { data: { prose: big } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_prose')
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-30 — 423 beats 409 ordering verified (no `current` on 423)', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-30')
    await bumpVersionViaService(beatId, { prose: tiptapDoc('x') })
    await bumpVersionViaService(beatId, { prose: tiptapDoc('y') })
    await bumpVersionViaService(beatId, { prose: tiptapDoc('z') })
    await bumpVersionViaService(beatId, { prose: tiptapDoc('w') })
    await setLocked(beatId, true)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('mine'), expected_version: 1 },
    })
    expect(res.status()).toBe(423)
    const body = await res.json()
    expect(body.error).toBe('node_locked')
    expect(body.current).toBeUndefined()
    await setLocked(beatId, false)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-31 — parent_locked returns 423 on a content edit', async () => {
    const { projectId, beatId, chapterId } = await setupBeat(orgA, 'TC-A-31')
    await setLocked(chapterId, true)
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/nodes/${beatId}`, {
      data: { prose: tiptapDoc('x') },
    })
    expect(res.status()).toBe(423)
    expect((await res.json()).error).toBe('parent_locked')
    await setLocked(chapterId, false)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctx.dispose()
  })

  test('TC-A-32 — Concurrent PATCHes with same expected_version: one 200, one 409', async () => {
    const { projectId, beatId } = await setupBeat(orgA, 'TC-A-32')
    const ctxA1 = await ctxA()
    const ctxA2 = await ctxA()
    // Race them
    const [r1, r2] = await Promise.all([
      ctxA1.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('A'), expected_version: 1 } }),
      ctxA2.patch(`/api/nodes/${beatId}`, { data: { prose: tiptapDoc('B'), expected_version: 1 } }),
    ])
    const statuses = [r1.status(), r2.status()].sort()
    expect(statuses).toEqual([200, 409])
    // Final db state has exactly one of A or B
    const final = await readNode(beatId)
    expect([tiptapDoc('A'), tiptapDoc('B')]).toContain(final!.prose)
    expect(final!.version).toBe(2)
    await adminClient().from('projects').delete().eq('id', projectId)
    await ctxA1.dispose()
    await ctxA2.dispose()
  })
})
