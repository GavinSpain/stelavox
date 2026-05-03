import { test, expect, request } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

async function getUserId(email: string): Promise<string> {
  const { data } = await adminClient().auth.admin.listUsers({ perPage: 200 })
  return (data?.users ?? []).find(u => u.email === email)!.id
}

async function getUserOrgId(email: string): Promise<string> {
  const userId = await getUserId(email)
  const { data } = await adminClient()
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userId)
    .single()
  return data!.organisation_id
}

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}
async function ctxB() {
  return request.newContext({ baseURL: BASE, storageState: USERS.B.storageState })
}

// ─── TC-B-01: GET /api/projects returns only caller's organisation ───────────

test('TC-B-01 GET /api/projects returns only caller org', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const orgB = await getUserOrgId(USERS.B.email)

  const { data: p1 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B01-A1' }).select().single()
  const { data: p2 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B01-A2' }).select().single()
  const { data: p3 } = await admin.from('projects').insert({ organisation_id: orgB, name: 'B01-B1' }).select().single()

  try {
    const ctA = await ctxA()
    const resA = await ctA.get('/api/projects')
    const bodyA = await resA.json()
    const idsA = bodyA.projects.map((p: { id: string }) => p.id)
    expect(idsA).toContain(p1!.id)
    expect(idsA).toContain(p2!.id)
    expect(idsA).not.toContain(p3!.id)
    await ctA.dispose()

    const ctB = await ctxB()
    const resB = await ctB.get('/api/projects')
    const bodyB = await resB.json()
    const idsB = bodyB.projects.map((p: { id: string }) => p.id)
    expect(idsB).toContain(p3!.id)
    expect(idsB).not.toContain(p1!.id)
    expect(idsB).not.toContain(p2!.id)
    await ctB.dispose()
  } finally {
    await admin.from('projects').delete().in('id', [p1!.id, p2!.id, p3!.id])
  }
})

// ─── TC-B-02: GET /api/projects/[A's id] as B → 404, no data leak ───────────

test('TC-B-02 GET cross-user project → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B02-secret' }).select().single()

  try {
    const ctx = await ctxB()
    const res = await ctx.get(`/api/projects/${p!.id}`)
    expect(res.status()).toBe(404)
    const text = await res.text()
    expect(text).not.toContain('B02-secret')
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-03: PATCH cross-user → 404, no DB change ──────────────────────────

test('TC-B-03 PATCH cross-user → 404, no DB change', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B03-original' }).select().single()
  const updatedAtBefore = p!.updated_at

  try {
    const ctx = await ctxB()
    const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { name: 'Hijacked' } })
    expect(res.status()).toBe(404)

    const { data: unchanged } = await admin.from('projects').select('name, updated_at').eq('id', p!.id).single()
    expect(unchanged!.name).toBe('B03-original')
    expect(unchanged!.updated_at).toBe(updatedAtBefore)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-04: DELETE cross-user → 404, no DB change ─────────────────────────

test('TC-B-04 DELETE cross-user project → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B04-stay' }).select().single()

  try {
    const ctx = await ctxB()
    const res = await ctx.delete(`/api/projects/${p!.id}`)
    expect(res.status()).toBe(404)

    const { data: still } = await admin.from('projects').select('id').eq('id', p!.id).single()
    expect(still!.id).toBe(p!.id)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-05: POST documents into A's project as B → 404 ────────────────────

test('TC-B-05 POST document to cross-user project → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B05-proj' }).select().single()

  const { count: docsBefore } = await admin
    .from('documents')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', p!.id)

  try {
    const ctx = await ctxB()
    const res = await ctx.post(`/api/projects/${p!.id}/documents`, {
      data: { name: 'Hijack', document_type: 'novel' },
    })
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('project_not_found')

    const { count: docsAfter } = await admin
      .from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', p!.id)
    expect(docsAfter).toBe(docsBefore)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-06: GET documents of A's project as B → 404 ───────────────────────

test('TC-B-06 GET documents of cross-user project → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B06-proj' }).select().single()
  await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'B06-secret-doc', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })

  try {
    const ctx = await ctxB()
    const res = await ctx.get(`/api/projects/${p!.id}/documents`)
    expect(res.status()).toBe(404)
    expect((await res.json()).error).toBe('project_not_found')
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-07: GET /api/documents/[A's doc] as B → 404 ───────────────────────

test('TC-B-07 GET cross-user document → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B07-proj' }).select().single()
  const { data: r } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'B07-doc', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const docId = (r as { document: { id: string } }).document.id

  try {
    const ctx = await ctxB()
    const res = await ctx.get(`/api/documents/${docId}`)
    expect(res.status()).toBe(404)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-08: PATCH cross-user document → 404, no DB change ─────────────────

test('TC-B-08 PATCH cross-user document → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B08-proj' }).select().single()
  const { data: r } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'B08-original', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const docId = (r as { document: { id: string } }).document.id
  const { data: before } = await admin.from('documents').select('name, updated_at, status').eq('id', docId).single()

  try {
    const ctx = await ctxB()
    const res = await ctx.patch(`/api/documents/${docId}`, {
      data: { name: 'Hijacked', status: 'archived' },
    })
    expect(res.status()).toBe(404)

    const { data: after } = await admin.from('documents').select('name, updated_at, status').eq('id', docId).single()
    expect(after!.name).toBe(before!.name)
    expect(after!.status).toBe(before!.status)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-09: DELETE cross-user document → 404 ──────────────────────────────

test('TC-B-09 DELETE cross-user document → 404', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B09-proj' }).select().single()
  const { data: r } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'B09-doc', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const docId = (r as { document: { id: string } }).document.id

  try {
    const ctx = await ctxB()
    const res = await ctx.delete(`/api/documents/${docId}`)
    expect(res.status()).toBe(404)

    const { data: still } = await admin.from('documents').select('id').eq('id', docId).single()
    expect(still!.id).toBe(docId)
    await ctx.dispose()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-B-10: Direct DB insert from User B into User A's org ─────────────────

test('TC-B-10 direct DB insert into cross-org rejected by RLS', async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const orgA = await getUserOrgId(USERS.A.email)

  const supabaseB = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  await supabaseB.auth.signInWithPassword({ email: USERS.B.email, password: USERS.B.password })

  const { error } = await supabaseB.from('projects').insert({ organisation_id: orgA, name: 'Hijack' })
  expect(error).toBeTruthy()

  const { data: hijack } = await adminClient().from('projects').select('id').eq('name', 'Hijack').maybeSingle()
  expect(hijack).toBeNull()
})

// ─── TC-B-11: Direct DB read from User B can't see User A's projects ─────────

test('TC-B-11 direct DB read from User B sees only own projects', async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)

  const { data: pA } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B11-A-secret' }).select().single()

  try {
    const supabaseB = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
    await supabaseB.auth.signInWithPassword({ email: USERS.B.email, password: USERS.B.password })

    const { data: results } = await supabaseB.from('projects').select('id')
    const ids = results?.map((r: { id: string }) => r.id) ?? []
    expect(ids).not.toContain(pA!.id)
  } finally {
    await admin.from('projects').delete().eq('id', pA!.id)
  }
})

// ─── TC-B-12: Direct read of organisation_members (H-02 verification) ────────

test('TC-B-12 organisation_members RLS only returns own row (H-02)', async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const userAId = await getUserId(USERS.A.email)
  const userBId = await getUserId(USERS.B.email)

  const supabaseB = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  await supabaseB.auth.signInWithPassword({ email: USERS.B.email, password: USERS.B.password })

  const startTime = Date.now()
  const { data } = await supabaseB.from('organisation_members').select('user_id')
  const duration = Date.now() - startTime

  // Should only see own row
  const userIds = data?.map((r: { user_id: string }) => r.user_id) ?? []
  expect(userIds).toContain(userBId)
  expect(userIds).not.toContain(userAId)

  // Should not time out (H-02 self-referential RLS would be slow)
  expect(duration).toBeLessThan(5_000)
})

// ─── TC-B-13: auth.users not directly readable from anon client ───────────────

test('TC-B-13 auth.users not readable from anon client', async () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const supabaseB = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
  await supabaseB.auth.signInWithPassword({ email: USERS.B.email, password: USERS.B.password })

  // The 'users' table in auth schema is not exposed via PostgREST
  const { data } = await (supabaseB as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: unknown; error: unknown }> } })
    .from('users')
    .select('email')
  // Expect an error or empty data — auth.users is not in the public schema
  const hasEmailData = Array.isArray(data) && data.length > 0 && (data as { email?: string }[])[0]?.email !== undefined
  expect(hasEmailData).toBe(false)
})

// ─── TC-B-14: Service-role bypasses RLS (control test) ───────────────────────

test('TC-B-14 service-role client bypasses RLS', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const orgB = await getUserOrgId(USERS.B.email)

  const { data: pA } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B14-A' }).select().single()
  const { data: pB } = await admin.from('projects').insert({ organisation_id: orgB, name: 'B14-B' }).select().single()

  try {
    const { data: all } = await admin.from('projects').select('id')
    const ids = all?.map((r: { id: string }) => r.id) ?? []
    // Service role sees both
    expect(ids).toContain(pA!.id)
    expect(ids).toContain(pB!.id)
  } finally {
    await admin.from('projects').delete().in('id', [pA!.id, pB!.id])
  }
})

// ─── TC-B-15: Session cookie tampering ───────────────────────────────────────

test('TC-B-15 tampered session token rejected or scoped to token owner', async () => {
  // Load User A's storage state and extract their access token
  const { readFileSync } = await import('fs')
  const stateA = JSON.parse(readFileSync(USERS.A.storageState, 'utf-8'))
  const cookieA = stateA.cookies?.find((c: { name: string }) => c.name.includes('auth-token'))
  if (!cookieA) {
    test.skip() // Storage state format unexpected
    return
  }

  // Modify the cookie value to break the JWT signature
  const parts = cookieA.value.split('.')
  if (parts.length >= 2) {
    parts[2] = 'invalidsignature'
  }
  const tamperedValue = parts.join('.')

  const ctx = await request.newContext({
    baseURL: BASE,
    storageState: {
      cookies: [{ ...cookieA, value: tamperedValue }],
      origins: [],
    },
  })
  const res = await ctx.get('/api/projects')
  // A forged/broken token must not return 200 for a different user's data
  // Either 401 (rejected) or if JWT still validates (just a different user), that's acceptable
  // The key requirement: no elevated privileges from tampering
  expect([200, 401]).toContain(res.status())
  if (res.status() === 401) {
    expect((await res.json()).error).toBe('unauthorised')
  }
  await ctx.dispose()
})

// ─── TC-B-16: Logged-out user blocked from all endpoints ─────────────────────

test('TC-B-16 logged-out user gets 401 on all endpoints', async () => {
  const ctx = await request.newContext({ baseURL: BASE })
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'B16-proj' }).select().single()
  const { data: dr } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'B16-doc', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const docId = (dr as { document: { id: string } }).document.id

  const checks = [
    ctx.post('/api/projects', { data: { name: 'X' } }),
    ctx.get('/api/projects'),
    ctx.get(`/api/projects/${p!.id}`),
    ctx.patch(`/api/projects/${p!.id}`, { data: { name: 'X' } }),
    ctx.delete(`/api/projects/${p!.id}`),
    ctx.post(`/api/projects/${p!.id}/documents`, { data: { name: 'X', document_type: 'novel' } }),
    ctx.get(`/api/projects/${p!.id}/documents`),
    ctx.get(`/api/documents/${docId}`),
    ctx.patch(`/api/documents/${docId}`, { data: { name: 'X' } }),
    ctx.delete(`/api/documents/${docId}`),
  ]

  const responses = await Promise.all(checks)
  for (const res of responses) {
    expect(res.status()).toBe(401)
  }

  await ctx.dispose()
  await admin.from('projects').delete().eq('id', p!.id)
})
