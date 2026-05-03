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

async function setupProject(orgId: string, name = 'Test Project') {
  const { data } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  return data!
}

async function setupDocument(projectId: string, orgId: string, name = 'Test Doc', type = 'novel') {
  const { data } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: name,
    p_description: null as unknown as string,
    p_document_type: type,
    p_authors: [],
  })
  return data as { document: { id: string; layer_stack_id: string }; layer_stack: { id: string; layers: unknown } }
}

// ─── POST /api/projects/[id]/documents ───────────────────────────────────────

test.describe('POST /api/projects/[id]/documents', () => {
  let orgA: string
  let project: { id: string }

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-38-project')
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-38 happy path: novel', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'My Novel', document_type: 'novel' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.document.document_type).toBe('novel')
    expect(body.document.status).toBe('active')
    expect(body.document.authors).toEqual([])
    // Phase 2 (M-020): root_node_id is back-filled by the RPC.
    expect(body.document.root_node_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
    expect(body.root_node).toBeTruthy()
    expect(body.root_node.id).toBe(body.document.root_node_id)
    expect(body.document.director_config_id).toBeNull()
    expect(body.document.layer_stack_id).toBe(body.layer_stack.id)
    expect(body.layer_stack.is_template).toBe(false)
    // layers should have 5 levels (book→act→chapter→scene→beat)
    const layers = body.layer_stack.layers as unknown[]
    expect(layers.length).toBe(5)
    await ctx.dispose()
  })

  // ─── TC-A-95..100 — Root-node creation (Phase 2 M-020) ────────────────

  test('TC-A-95 response shape includes root_node', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'TC-A-95 doc', document_type: 'novel' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body).toHaveProperty('document')
    expect(body).toHaveProperty('layer_stack')
    expect(body).toHaveProperty('root_node')
    await ctx.dispose()
  })

  test('TC-A-96 root node properties', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'TC-A-96 doc', document_type: 'novel' },
    })
    const body = await res.json()
    expect(body.root_node.parent_id).toBeNull()
    expect(body.root_node.node_category).toBe('structural')
    expect(body.root_node.node_type).toBe('book')
    expect(body.root_node.name).toBe('TC-A-96 doc')
    expect(body.root_node.order).toBe(1)
    expect(body.root_node.depth).toBe(0)
    expect(body.root_node.layer_index).toBe(0)
    expect(body.root_node.status).toBe('draft')
    await ctx.dispose()
  })

  test('TC-A-97 documents.root_node_id back-filled', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'TC-A-97 doc', document_type: 'novel' },
    })
    const body = await res.json()
    const { data: docRow } = await adminClient()
      .from('documents').select('root_node_id').eq('id', body.document.id).single()
    expect(docRow!.root_node_id).toBe(body.root_node.id)
    await ctx.dispose()
  })

  test('TC-A-98 short_story root is "story" type', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'TC-A-98 doc', document_type: 'short_story' },
    })
    expect(res.status()).toBe(201)
    expect((await res.json()).root_node.node_type).toBe('story')
    await ctx.dispose()
  })

  test('TC-A-99 series root is "series" type', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'TC-A-99 doc', document_type: 'series' },
    })
    expect(res.status()).toBe(201)
    expect((await res.json()).root_node.node_type).toBe('series')
    await ctx.dispose()
  })

  test('TC-A-100 atomicity: missing template causes full rollback', async () => {
    // Force missing_template by passing an unsupported document_type.
    // Per the RPC, this raises before any INSERT — no partial rows.
    // Scope counts to this test's project (not global) — global counts
    // race with other parallel tests inserting/deleting rows.
    const admin = adminClient()

    const before = {
      docs:   (await admin.from('documents').select('*', { count: 'exact', head: true }).eq('project_id', project.id)).count ?? 0,
      stacks: (await admin.from('layer_stacks').select('*', { count: 'exact', head: true }).eq('organisation_id', orgA)).count ?? 0,
      nodes:  (await admin.from('nodes').select('*', { count: 'exact', head: true }).eq('project_id', project.id)).count ?? 0,
    }

    const { error: rpcErr } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: project.id, p_organisation_id: orgA,
      p_name: 'TC-A-100 doc', p_description: null as unknown as string,
      p_document_type: 'nonexistent_template', p_authors: [],
    })
    expect(rpcErr).not.toBeNull()
    expect(rpcErr!.message).toContain('missing_template')

    const after = {
      docs:   (await admin.from('documents').select('*', { count: 'exact', head: true }).eq('project_id', project.id)).count ?? 0,
      stacks: (await admin.from('layer_stacks').select('*', { count: 'exact', head: true }).eq('organisation_id', orgA)).count ?? 0,
      nodes:  (await admin.from('nodes').select('*', { count: 'exact', head: true }).eq('project_id', project.id)).count ?? 0,
    }
    expect(after).toEqual(before)
  })

  test('TC-A-39 happy path: short_story', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'Short', document_type: 'short_story' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.document.document_type).toBe('short_story')
    const layers = body.layer_stack.layers as unknown[]
    expect(layers.length).toBe(3)
    await ctx.dispose()
  })

  test('TC-A-40 happy path: series', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'Series', document_type: 'series' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.document.document_type).toBe('series')
    const layers = body.layer_stack.layers as unknown[]
    expect(layers.length).toBe(6)
    await ctx.dispose()
  })

  test('TC-A-41 happy path with authors', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'N', document_type: 'novel', authors: ['A. Author', 'B. Author'] },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.document.authors).toEqual(['A. Author', 'B. Author'])
    await ctx.dispose()
  })

  test('TC-A-42 invalid document_type → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X', document_type: 'academic_paper' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_document_type')
    await ctx.dispose()
  })

  test('TC-A-43 missing document_type → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_document_type')
    await ctx.dispose()
  })

  test('TC-A-44 invalid authors element (empty string) → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X', document_type: 'novel', authors: ['', 'B'] },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_authors')
    await ctx.dispose()
  })

  test('TC-A-45 too many authors → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X', document_type: 'novel', authors: Array(21).fill('A') },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_authors')
    await ctx.dispose()
  })

  test('TC-A-46 unknown field (status) → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X', document_type: 'novel', status: 'archived' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_field')
    await ctx.dispose()
  })

  test('TC-A-47 invalid project UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects/abc/documents', {
      data: { name: 'X', document_type: 'novel' },
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-48 project not found → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${NULL_UUID}/documents`, {
      data: { name: 'X', document_type: 'novel' },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('project_not_found')
    await ctx.dispose()
  })

  test('TC-A-49 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.post(`/api/projects/${project.id}/documents`, {
      data: { name: 'X', document_type: 'novel' },
    })
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })

  test('TC-A-50 atomicity: missing template → RPC raises, no orphaned document', async () => {
    const admin = adminClient()

    const { count: docsBefore } = await admin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)

    // Call the DB function directly with a type that has no template.
    // Service-role skips the membership/project checks (migration 019).
    // The function raises missing_template before any INSERT — no shared template touched.
    const { data, error } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: project.id,
      p_organisation_id: orgA,
      p_name: 'Atomic Test',
      p_description: null as unknown as string,
      p_document_type: 'test_atomicity_check',
      p_authors: [],
    })
    expect(error).toBeTruthy()
    expect(error!.message).toContain('missing_template')
    expect(data).toBeNull()

    const { count: docsAfter } = await admin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', project.id)
    expect(docsAfter).toBe(docsBefore)
  })
})

// ─── GET /api/projects/[id]/documents ────────────────────────────────────────

test.describe('GET /api/projects/[id]/documents', () => {
  let orgA: string
  let project: { id: string }
  let d1id: string
  let d2id: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-51-project')
    const r1 = await setupDocument(project.id, orgA, 'Active Doc', 'novel')
    d1id = r1.document.id
    const r2 = await setupDocument(project.id, orgA, 'Archived Doc', 'novel')
    d2id = r2.document.id
    // Archive d2
    await adminClient().from('documents').update({ status: 'archived' }).eq('id', d2id)
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-51 happy path returns all docs', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${project.id}/documents`)
    expect(res.status()).toBe(200)
    const { documents } = await res.json()
    const ids = documents.map((d: { id: string }) => d.id)
    expect(ids).toContain(d1id)
    expect(ids).toContain(d2id)
    await ctx.dispose()
  })

  test('TC-A-52 empty when no documents', async () => {
    const orgA2 = await getUserOrgId(USERS.A.email)
    const emptyProject = await setupProject(orgA2, 'TC-A-52-empty')
    try {
      const ctx = await ctxA()
      const res = await ctx.get(`/api/projects/${emptyProject.id}/documents`)
      expect(res.status()).toBe(200)
      expect((await res.json()).documents).toEqual([])
      await ctx.dispose()
    } finally {
      await adminClient().from('projects').delete().eq('id', emptyProject.id)
    }
  })

  test('TC-A-53 status=active filter', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${project.id}/documents?status=active`)
    expect(res.status()).toBe(200)
    const { documents } = await res.json()
    const ids = documents.map((d: { id: string }) => d.id)
    expect(ids).toContain(d1id)
    expect(ids).not.toContain(d2id)
    await ctx.dispose()
  })

  test('TC-A-54 status=archived filter', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${project.id}/documents?status=archived`)
    expect(res.status()).toBe(200)
    const { documents } = await res.json()
    const ids = documents.map((d: { id: string }) => d.id)
    expect(ids).toContain(d2id)
    expect(ids).not.toContain(d1id)
    await ctx.dispose()
  })

  test('TC-A-55 invalid status → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${project.id}/documents?status=draft`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_status')
    await ctx.dispose()
  })

  test('TC-A-56 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/projects/not-uuid/documents')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-57 project not visible to User B → 404', async () => {
    const ctx = await request.newContext({ baseURL: BASE, storageState: USERS.B.storageState })
    const res = await ctx.get(`/api/projects/${project.id}/documents`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('project_not_found')
    await ctx.dispose()
  })

  test('TC-A-58 unknown query param → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${project.id}/documents?foo=bar`)
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_param')
    await ctx.dispose()
  })

  test('TC-A-59 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/projects/${project.id}/documents`)
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── GET /api/documents/[id] ─────────────────────────────────────────────────

test.describe('GET /api/documents/[id]', () => {
  let orgA: string
  let project: { id: string }
  let docId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-60-project')
    const r = await setupDocument(project.id, orgA, 'TC-A-60 Doc')
    docId = r.document.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-60 happy path (no layer_stack in response)', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${docId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.document.id).toBe(docId)
    expect(body.layer_stack).toBeUndefined()
    await ctx.dispose()
  })

  test('TC-A-61 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/documents/bad-uuid')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-62 non-existent → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/documents/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-63 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/documents/${docId}`)
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── PATCH /api/documents/[id] ───────────────────────────────────────────────

test.describe('PATCH /api/documents/[id]', () => {
  let orgA: string
  let project: { id: string }
  let docId: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-64-project')
    const r = await setupDocument(project.id, orgA, 'Original Name')
    docId = r.document.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-64 rename', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { name: 'New Name' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.document.name).toBe('New Name')
    await ctx.dispose()
  })

  test('TC-A-65 archive', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { status: 'archived' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).document.status).toBe('archived')
    await ctx.dispose()
  })

  test('TC-A-66 publish', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { status: 'published' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).document.status).toBe('published')
    await ctx.dispose()
  })

  test('TC-A-67 status transition without restriction', async () => {
    // Set to archived then back to active
    const ctx = await ctxA()
    await ctx.patch(`/api/documents/${docId}`, { data: { status: 'archived' } })
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { status: 'active' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).document.status).toBe('active')
    await ctx.dispose()
  })

  test('TC-A-68 invalid status → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { status: 'draft' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_status')
    await ctx.dispose()
  })

  test('TC-A-69 forbidden field document_type → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { document_type: 'short_story' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_field')
    await ctx.dispose()
  })

  test('TC-A-70 forbidden field project_id → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { project_id: NULL_UUID } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_field')
    await ctx.dispose()
  })

  test('TC-A-71 empty body → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: {} })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('empty_update')
    await ctx.dispose()
  })

  test('TC-A-72 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch('/api/documents/bad-uuid', { data: { name: 'X' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-73 non-existent → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/documents/${NULL_UUID}`, { data: { name: 'X' } })
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-74 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.patch(`/api/documents/${docId}`, { data: { name: 'X' } })
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── DELETE /api/documents/[id] ──────────────────────────────────────────────

test.describe('DELETE /api/documents/[id]', () => {
  let orgA: string
  let project: { id: string }

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    project = await setupProject(orgA, 'TC-A-75-project')
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', project.id)
  })

  test('TC-A-75 happy path cascades layer_stack', async () => {
    const r = await setupDocument(project.id, orgA, 'TC-A-75 Doc')
    const docId = r.document.id
    const lsId = r.layer_stack.id

    const ctx = await ctxA()
    const res = await ctx.delete(`/api/documents/${docId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
    expect(body.document_id).toBe(docId)

    const { data: dead } = await adminClient().from('documents').select('id').eq('id', docId).maybeSingle()
    expect(dead).toBeNull()
    const { data: lsDead } = await adminClient().from('layer_stacks').select('id').eq('id', lsId).maybeSingle()
    expect(lsDead).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-76 body must be empty → 400', async () => {
    const r = await setupDocument(project.id, orgA, 'TC-A-76 Doc')
    try {
      const ctx = await ctxA()
      const res = await ctx.delete(`/api/documents/${r.document.id}`, {
        headers: { 'content-type': 'application/json' },
        data: { force: true },
      })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('unexpected_body')
      await ctx.dispose()
    } finally {
      await adminClient().from('documents').delete().eq('id', r.document.id)
    }
  })

  test('TC-A-77 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete('/api/documents/bad-uuid')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-78 non-existent → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/documents/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-79 second DELETE → 404', async () => {
    const r = await setupDocument(project.id, orgA, 'TC-A-79 Doc')
    const ctx = await ctxA()
    await ctx.delete(`/api/documents/${r.document.id}`)
    const res2 = await ctx.delete(`/api/documents/${r.document.id}`)
    expect(res2.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-80 no session → 401', async () => {
    const r = await setupDocument(project.id, orgA, 'TC-A-80 Doc')
    try {
      const ctx = await ctxNone()
      const res = await ctx.delete(`/api/documents/${r.document.id}`)
      expect(res.status()).toBe(401)
      await ctx.dispose()
    } finally {
      await adminClient().from('documents').delete().eq('id', r.document.id)
    }
  })
})
