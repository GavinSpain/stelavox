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

// ─── POST /api/projects ──────────────────────────────────────────────────────

test.describe('POST /api/projects', () => {
  const created: string[] = []

  test.afterAll(async () => {
    const admin = adminClient()
    for (const id of created) await admin.from('projects').delete().eq('id', id)
  })

  test('TC-A-01 happy path', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: 'Project Alpha' } })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.project).toMatchObject({ name: 'Project Alpha', description: null, default_document_type: null })
    expect(body.project.id).toBeTruthy()
    created.push(body.project.id)
    await ctx.dispose()
  })

  test('TC-A-02 all optional fields', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', {
      data: { name: 'Project Beta', description: 'A trilogy', default_document_type: 'novel' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.project.description).toBe('A trilogy')
    expect(body.project.default_document_type).toBe('novel')
    created.push(body.project.id)
    await ctx.dispose()
  })

  test('TC-A-03 name trimmed', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: '  Padded  ' } })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.project.name).toBe('Padded')
    created.push(body.project.id)
    await ctx.dispose()
  })

  test('TC-A-04 name empty after trim → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: '   ' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_name')
    await ctx.dispose()
  })

  test('TC-A-05 name >200 chars → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: 'a'.repeat(201) } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_name')
    await ctx.dispose()
  })

  test('TC-A-06 description >5000 chars → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: 'P', description: 'x'.repeat(5001) } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_description')
    await ctx.dispose()
  })

  test('TC-A-07 invalid default_document_type → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: 'P', default_document_type: 'academic_paper' } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_document_type')
    await ctx.dispose()
  })

  test('TC-A-08 unknown field → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', { data: { name: 'P', owner_id: NULL_UUID } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_field')
    await ctx.dispose()
  })

  test('TC-A-09 empty body → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', {
      headers: { 'content-type': 'application/json' },
      data: '',
    })
    expect(res.status()).toBe(400)
    await ctx.dispose()
  })

  test('TC-A-10 non-JSON body → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.post('/api/projects', {
      headers: { 'content-type': 'application/json' },
      data: Buffer.from('not json'),
    })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_json')
    await ctx.dispose()
  })

  test('TC-A-11 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.post('/api/projects', { data: { name: 'Project Alpha' } })
    expect(res.status()).toBe(401)
    expect((await res.json()).error).toBe('unauthorised')
    await ctx.dispose()
  })
})

// ─── GET /api/projects ───────────────────────────────────────────────────────

test.describe('GET /api/projects', () => {
  test('TC-A-12 returns only caller projects', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const orgB = await getUserOrgId(USERS.B.email)

    const { data: p1 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'A-p1' }).select().single()
    const { data: p2 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'A-p2' }).select().single()
    const { data: p3 } = await admin.from('projects').insert({ organisation_id: orgB, name: 'B-p1' }).select().single()

    try {
      const ctx = await ctxA()
      const res = await ctx.get('/api/projects')
      expect(res.status()).toBe(200)
      const body = await res.json()
      const ids = body.projects.map((p: { id: string }) => p.id)
      expect(ids).toContain(p1!.id)
      expect(ids).toContain(p2!.id)
      expect(ids).not.toContain(p3!.id)
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().in('id', [p1!.id, p2!.id, p3!.id])
    }
  })

  test('TC-A-13 empty list when no projects', async () => {
    const ctx = await request.newContext({ baseURL: BASE, storageState: USERS.C.storageState })
    const res = await ctx.get('/api/projects')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.projects).toEqual([])
    await ctx.dispose()
  })

  test('TC-A-14 order is created_at DESC', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: pa } = await admin.from('projects').insert({ organisation_id: orgA, name: 'order-1' }).select().single()
    await new Promise(r => setTimeout(r, 50))
    const { data: pb } = await admin.from('projects').insert({ organisation_id: orgA, name: 'order-2' }).select().single()
    await new Promise(r => setTimeout(r, 50))
    const { data: pc } = await admin.from('projects').insert({ organisation_id: orgA, name: 'order-3' }).select().single()

    try {
      const ctx = await ctxA()
      const res = await ctx.get('/api/projects')
      const { projects } = await res.json()
      const myOrder = projects.filter((p: { id: string }) => [pa!.id, pb!.id, pc!.id].includes(p.id))
      expect(myOrder[0].id).toBe(pc!.id)
      expect(myOrder[1].id).toBe(pb!.id)
      expect(myOrder[2].id).toBe(pa!.id)
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().in('id', [pa!.id, pb!.id, pc!.id])
    }
  })

  test('TC-A-15 unknown query param → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/projects?foo=bar')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_param')
    await ctx.dispose()
  })

  test('TC-A-16 ?status=archived → 400 in Phase 1', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/projects?status=archived')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('unknown_param')
    await ctx.dispose()
  })

  test('TC-A-17 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.get('/api/projects')
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── GET /api/projects/[id] ──────────────────────────────────────────────────

test.describe('GET /api/projects/[id]', () => {
  test('TC-A-18 happy path', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-18' }).select().single()

    try {
      const ctx = await ctxA()
      const res = await ctx.get(`/api/projects/${p!.id}`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.project.id).toBe(p!.id)
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-19 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/projects/not-a-uuid')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-20 non-existent UUID → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.get(`/api/projects/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-21 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.get(`/api/projects/${NULL_UUID}`)
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── PATCH /api/projects/[id] ────────────────────────────────────────────────

test.describe('PATCH /api/projects/[id]', () => {
  test('TC-A-22 rename', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'Original' }).select().single()

    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { name: 'Renamed' } })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.project.name).toBe('Renamed')
      expect(new Date(body.project.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(body.project.created_at).getTime()
      )
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-23 clear description', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects')
      .insert({ organisation_id: orgA, name: 'TC-A-23', description: 'something' })
      .select().single()

    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { description: null } })
      expect(res.status()).toBe(200)
      expect((await res.json()).project.description).toBeNull()
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-24 empty body → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-24' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: {} })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('empty_update')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-25 forbidden field id → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-25' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { id: NULL_UUID, name: 'X' } })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('unknown_field')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-26 forbidden field organisation_id → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-26' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { organisation_id: NULL_UUID } })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('unknown_field')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-27 invalid name → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-27' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { name: '' } })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('invalid_name')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-28 invalid default_document_type → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-28' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { default_document_type: 'essay' } })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('invalid_document_type')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-29 non-existent UUID → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.patch(`/api/projects/${NULL_UUID}`, { data: { name: 'X' } })
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-30 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.patch(`/api/projects/${NULL_UUID}`, { data: { name: 'X' } })
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})

// ─── DELETE /api/projects/[id] ───────────────────────────────────────────────

test.describe('DELETE /api/projects/[id]', () => {
  test('TC-A-31 happy path', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-31' }).select().single()

    const ctx = await ctxA()
    const res = await ctx.delete(`/api/projects/${p!.id}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBe(true)
    expect(body.project_id).toBe(p!.id)

    const { data: dead } = await admin.from('projects').select('id').eq('id', p!.id).maybeSingle()
    expect(dead).toBeNull()
    await ctx.dispose()
  })

  test('TC-A-32 cascade deletes documents and layer stacks', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-32' }).select().single()
    const r1 = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: p!.id, p_organisation_id: orgA,
      p_name: 'D1', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
    })
    const r2 = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: p!.id, p_organisation_id: orgA,
      p_name: 'D2', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
    })
    const d1id = (r1.data as { document: { id: string } }).document.id
    const d2id = (r2.data as { document: { id: string } }).document.id
    const ls1id = (r1.data as { layer_stack: { id: string } }).layer_stack.id
    const ls2id = (r2.data as { layer_stack: { id: string } }).layer_stack.id

    const ctx = await ctxA()
    const res = await ctx.delete(`/api/projects/${p!.id}`)
    expect(res.status()).toBe(200)

    for (const id of [d1id, d2id]) {
      const { data } = await admin.from('documents').select('id').eq('id', id).maybeSingle()
      expect(data).toBeNull()
    }
    for (const id of [ls1id, ls2id]) {
      const { data } = await admin.from('layer_stacks').select('id').eq('id', id).maybeSingle()
      expect(data).toBeNull()
    }
    await ctx.dispose()
  })

  test('TC-A-33 body must be empty → 400', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-33' }).select().single()
    try {
      const ctx = await ctxA()
      const res = await ctx.delete(`/api/projects/${p!.id}`, {
        headers: { 'content-type': 'application/json' },
        data: { force: true },
      })
      expect(res.status()).toBe(400)
      expect((await res.json()).error).toBe('unexpected_body')
      await ctx.dispose()
    } finally {
      await admin.from('projects').delete().eq('id', p!.id)
    }
  })

  test('TC-A-34 invalid UUID → 400', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete('/api/projects/abc')
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toBe('invalid_uuid')
    await ctx.dispose()
  })

  test('TC-A-35 non-existent UUID → 404', async () => {
    const ctx = await ctxA()
    const res = await ctx.delete(`/api/projects/${NULL_UUID}`)
    expect(res.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-36 second DELETE → 404', async () => {
    const admin = adminClient()
    const orgA = await getUserOrgId(USERS.A.email)
    const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'TC-A-36' }).select().single()
    const ctx = await ctxA()
    await ctx.delete(`/api/projects/${p!.id}`)
    const res2 = await ctx.delete(`/api/projects/${p!.id}`)
    expect(res2.status()).toBe(404)
    await ctx.dispose()
  })

  test('TC-A-37 no session → 401', async () => {
    const ctx = await ctxNone()
    const res = await ctx.delete(`/api/projects/${NULL_UUID}`)
    expect(res.status()).toBe(401)
    await ctx.dispose()
  })
})
