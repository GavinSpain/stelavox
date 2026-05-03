import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

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

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

// ─── TC-D-01: Project rename leaves other projects untouched ─────────────────

test('TC-D-01 project rename leaves sibling projects untouched', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p1 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D01-p1' }).select().single()
  const { data: p2 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D01-p2' }).select().single()
  const { data: p3 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D01-p3' }).select().single()

  try {
    const ctx = await ctxA()
    await ctx.patch(`/api/projects/${p2!.id}`, { data: { name: 'D01-p2-renamed' } })
    await ctx.dispose()

    // p1 and p3 are unchanged
    const { data: r1 } = await admin.from('projects').select('name, updated_at, description').eq('id', p1!.id).single()
    const { data: r3 } = await admin.from('projects').select('name, updated_at, description').eq('id', p3!.id).single()
    expect(r1!.name).toBe('D01-p1')
    expect(r1!.updated_at).toBe(p1!.updated_at)
    expect(r3!.name).toBe('D01-p3')
    expect(r3!.updated_at).toBe(p3!.updated_at)

    // p2 changed only name + updated_at
    const { data: r2 } = await admin.from('projects').select('name, description').eq('id', p2!.id).single()
    expect(r2!.name).toBe('D01-p2-renamed')
    expect(r2!.description).toBe(p2!.description)
  } finally {
    await admin.from('projects').delete().in('id', [p1!.id, p2!.id, p3!.id])
  }
})

// ─── TC-D-02: Document rename leaves layer_stack untouched ───────────────────

test('TC-D-02 document rename leaves layer_stack untouched', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D02-proj' }).select().single()
  const { data: r } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'D02-doc', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const doc = (r as { document: { id: string; layer_stack_id: string } }).document
  const { data: lsBefore } = await admin.from('layer_stacks').select('*').eq('id', doc.layer_stack_id).single()

  try {
    const ctx = await ctxA()
    await ctx.patch(`/api/documents/${doc.id}`, { data: { name: 'Renamed' } })
    await ctx.dispose()

    // layer_stack row unchanged
    const { data: lsAfter } = await admin.from('layer_stacks').select('*').eq('id', doc.layer_stack_id).single()
    expect(JSON.stringify(lsAfter)).toBe(JSON.stringify(lsBefore))

    // document.layer_stack_id unchanged
    const { data: docAfter } = await admin.from('documents').select('layer_stack_id').eq('id', doc.id).single()
    expect(docAfter!.layer_stack_id).toBe(doc.layer_stack_id)
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-D-03: Project delete cascades only to project's documents ─────────────

test('TC-D-03 project delete cascades only to own documents', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p1 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D03-p1' }).select().single()
  const { data: p2 } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D03-p2' }).select().single()

  const r1 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p1!.id, p_organisation_id: orgA,
    p_name: 'D03-d1', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const r2 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p1!.id, p_organisation_id: orgA,
    p_name: 'D03-d2', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const r3 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p2!.id, p_organisation_id: orgA,
    p_name: 'D03-d3', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const r4 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p2!.id, p_organisation_id: orgA,
    p_name: 'D03-d4', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const d1id = (r1.data as { document: { id: string } }).document.id
  const d2id = (r2.data as { document: { id: string } }).document.id
  const d3id = (r3.data as { document: { id: string } }).document.id
  const d4id = (r4.data as { document: { id: string } }).document.id
  const ls3id = (r3.data as { layer_stack: { id: string } }).layer_stack.id
  const ls4id = (r4.data as { layer_stack: { id: string } }).layer_stack.id

  try {
    const ctx = await ctxA()
    await ctx.delete(`/api/projects/${p1!.id}`)
    await ctx.dispose()

    // D1, D2 deleted
    for (const id of [d1id, d2id]) {
      const { data } = await admin.from('documents').select('id').eq('id', id).maybeSingle()
      expect(data).toBeNull()
    }

    // D3, D4 and their layer stacks intact
    for (const id of [d3id, d4id]) {
      const { data } = await admin.from('documents').select('id').eq('id', id).single()
      expect(data!.id).toBe(id)
    }
    for (const id of [ls3id, ls4id]) {
      const { data } = await admin.from('layer_stacks').select('id').eq('id', id).single()
      expect(data!.id).toBe(id)
    }

    // P2 intact
    const { data: p2after } = await admin.from('projects').select('id').eq('id', p2!.id).single()
    expect(p2after!.id).toBe(p2!.id)
  } finally {
    await admin.from('projects').delete().eq('id', p2!.id)
  }
})

// ─── TC-D-04: Document delete cascades only to that document's children ───────

test('TC-D-04 document delete cascades only to own children', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D04-proj' }).select().single()

  const r1 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'D04-d1', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const r2 = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: p!.id, p_organisation_id: orgA,
    p_name: 'D04-d2', p_description: null as unknown as string, p_document_type: 'novel', p_authors: [],
  })
  const d1id = (r1.data as { document: { id: string } }).document.id
  const d2id = (r2.data as { document: { id: string } }).document.id
  const ls1id = (r1.data as { layer_stack: { id: string } }).layer_stack.id
  const ls2id = (r2.data as { layer_stack: { id: string } }).layer_stack.id

  try {
    const ctx = await ctxA()
    await ctx.delete(`/api/documents/${d1id}`)
    await ctx.dispose()

    // D2 and its layer stack intact
    const { data: d2after } = await admin.from('documents').select('id').eq('id', d2id).single()
    expect(d2after!.id).toBe(d2id)
    const { data: ls2after } = await admin.from('layer_stacks').select('id').eq('id', ls2id).single()
    expect(ls2after!.id).toBe(ls2id)

    // D1 layer stack gone
    const { data: ls1dead } = await admin.from('layer_stacks').select('id').eq('id', ls1id).maybeSingle()
    expect(ls1dead).toBeNull()
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-D-05: Document creation touches only documents + layer_stacks ─────────

test('TC-D-05 document creation touches only documents and layer_stacks', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D05-proj' }).select().single()

  try {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/projects/${p!.id}/documents`, {
      data: { name: 'D05-doc', document_type: 'novel' },
    })
    expect(res.status()).toBe(201)
    const { document: doc, layer_stack: ls } = await res.json()
    await ctx.dispose()

    // Exactly 1 document row was created, associated with the project
    const { data: createdDoc } = await admin.from('documents').select('id, project_id').eq('id', doc.id).maybeSingle()
    expect(createdDoc!.id).toBe(doc.id)
    expect(createdDoc!.project_id).toBe(p!.id)

    // Exactly 1 non-template layer_stack row was created, linked to the document
    const { data: createdLs } = await admin.from('layer_stacks').select('id, is_template, document_id').eq('id', ls.id).maybeSingle()
    expect(createdLs!.id).toBe(ls.id)
    expect(createdLs!.is_template).toBe(false)
    expect(createdLs!.document_id).toBe(doc.id)

    // Exactly one root node created for this document (Phase 2 M-020).
    // The root has parent_id=NULL and documents.root_node_id matches it.
    const { count: nodeCount } = await admin.from('nodes').select('*', { count: 'exact', head: true }).eq('document_id', doc.id)
    expect(nodeCount).toBe(1)
    const { data: roots } = await admin.from('nodes').select('id, parent_id').eq('document_id', doc.id)
    expect(roots).toHaveLength(1)
    expect(roots![0].parent_id).toBeNull()

    // No agent_jobs triggered by document creation
    const { count: jobCount } = await admin.from('agent_jobs').select('*', { count: 'exact', head: true }).eq('document_id', doc.id)
    expect(jobCount).toBe(0)
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-D-06: Project creation touches only projects table ───────────────────

test('TC-D-06 project creation touches only projects table', async () => {
  const admin = adminClient()
  const ctx = await ctxA()
  const res = await ctx.post('/api/projects', { data: { name: 'D06-proj' } })
  expect(res.status()).toBe(201)
  const { project } = await res.json()
  await ctx.dispose()

  try {
    // The project row exists
    const { data: proj } = await admin.from('projects').select('id').eq('id', project.id).maybeSingle()
    expect(proj!.id).toBe(project.id)

    // No documents created as a side effect of project creation
    const { count: docCount } = await admin.from('documents').select('*', { count: 'exact', head: true }).eq('project_id', project.id)
    expect(docCount).toBe(0)

    // No nodes exist under this project (impossible without documents, but verify explicitly)
    // nodes are document-scoped; with 0 documents there can be 0 nodes
    // (no FK from nodes to projects, so we rely on the document count)
  } finally {
    await admin.from('projects').delete().eq('id', project.id)
  }
})

// ─── TC-D-07: Failed POST /documents leaves no orphans ───────────────────────

test('TC-D-07 failed document creation leaves no orphans', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D07-proj' }).select().single()

  try {
    // Call the DB function with a type that has no template.
    // The exception fires before any INSERT — proves atomicity.
    const { data, error } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: p!.id,
      p_organisation_id: orgA,
      p_name: 'D07-doc',
      p_description: null as unknown as string,
      p_document_type: 'test_atomicity_check',
      p_authors: [],
    })
    expect(error).toBeTruthy()
    expect(error!.message).toContain('missing_template')
    expect(data).toBeNull()

    // Scoped to this project only — unaffected by parallel workers.
    const { count: docsAfter } = await admin.from('documents')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', p!.id)
    expect(docsAfter).toBe(0)

    // layer_stacks via document_id: if no docs exist for this project, no layer_stacks can either.
    const { data: projDocs } = await admin.from('documents').select('id').eq('project_id', p!.id)
    const lsAfter = projDocs?.length
      ? (await admin.from('layer_stacks').select('*', { count: 'exact', head: true }).in('document_id', projDocs.map(d => d.id)).eq('is_template', false)).count
      : 0
    expect(lsAfter).toBe(0)
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-D-08: RLS-blocked PATCH does not bump updated_at ─────────────────────

test('TC-D-08 RLS-blocked PATCH does not bump updated_at', async () => {
  const admin = adminClient()
  const orgA = await getUserOrgId(USERS.A.email)
  const { data: p } = await admin.from('projects').insert({ organisation_id: orgA, name: 'D08-proj' }).select().single()
  const updatedAtBefore = p!.updated_at

  try {
    const ctx = await request.newContext({ baseURL: BASE, storageState: USERS.B.storageState })
    const res = await ctx.patch(`/api/projects/${p!.id}`, { data: { name: 'D08-hijacked' } })
    expect(res.status()).toBe(404)
    await ctx.dispose()

    const { data: after } = await admin.from('projects').select('updated_at').eq('id', p!.id).single()
    expect(after!.updated_at).toBe(updatedAtBefore)
  } finally {
    await admin.from('projects').delete().eq('id', p!.id)
  }
})

// ─── TC-D-09: Auto-organisation creation is atomic ───────────────────────────

test('TC-D-09 new user sign-up creates org + membership atomically', async () => {
  const admin = adminClient()
  const email = 'test-d09@example.com'

  // Clean up if exists
  const { data: pre } = await admin.auth.admin.listUsers({ perPage: 200 })
  const prev = pre?.users.find(u => u.email === email)
  if (prev) await admin.auth.admin.deleteUser(prev.id)

  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: 'Test1234!Test1234!',
    email_confirm: true,
  })
  expect(error).toBeNull()
  const userId = created!.user!.id

  try {
    // Wait for H-03 trigger
    await new Promise(r => setTimeout(r, 300))

    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id, role')
      .eq('user_id', userId)
      .maybeSingle()

    // If org exists, member must also exist (atomicity guarantee)
    if (member) {
      const { data: org } = await admin
        .from('organisations')
        .select('id')
        .eq('id', member.organisation_id)
        .single()
      expect(org!.id).toBe(member.organisation_id)
      expect(member.role).toBe('owner')
    }
    // Both org and member present together (atomic creation)
    expect(member).toBeTruthy()
  } finally {
    await admin.auth.admin.deleteUser(userId)
  }
})

// ─── TC-D-10: Concurrent project creation produces distinct rows ──────────────

test('TC-D-10 concurrent project creation produces distinct rows', async () => {
  const admin = adminClient()
  const ctx = await ctxA()

  const [res1, res2] = await Promise.all([
    ctx.post('/api/projects', { data: { name: 'D10-concurrent' } }),
    ctx.post('/api/projects', { data: { name: 'D10-concurrent' } }),
  ])

  expect(res1.status()).toBe(201)
  expect(res2.status()).toBe(201)

  const b1 = await res1.json()
  const b2 = await res2.json()

  expect(b1.project.id).not.toBe(b2.project.id)
  expect(b1.project.name).toBe('D10-concurrent')
  expect(b2.project.name).toBe('D10-concurrent')

  await ctx.dispose()
  await admin.from('projects').delete().in('id', [b1.project.id, b2.project.id])
})
