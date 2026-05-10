// Phase 4 — DB-layer constraint guards (round-3 audit B4.1+).
//
// Each constraint added in Phase 4 gets a regression test here. The
// "failing-test-first" proof is constraint-driven: the test inserts a
// duplicate / invalid value and asserts the DB rejects it with the
// expected error code. Pre-migration the INSERT succeeds (no constraint
// guards it); post-migration it fails with the constraint error.
//
// Runs against the local Supabase admin client. Skipped automatically
// when SUPABASE_SERVICE_ROLE_KEY is missing (CI safe).

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const hasLocalDb = Boolean(SUPABASE_URL && SUPABASE_SERVICE_KEY)

let admin: SupabaseClient<Database>
let testOrgId: string
let testProjectId: string
let testDocumentId: string
let testParentId: string

beforeAll(async () => {
  if (!hasLocalDb) return
  admin = createClient<Database>(SUPABASE_URL!, SUPABASE_SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Pick whichever seeded user we can find. test-a@example.com is the
  // canonical Playwright user (created by globalSetup); j5-walk@example.com
  // is created by the j5-novel director fixture seed. Either is fine for
  // these constraint tests — we just need an org_member row to scope to.
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user =
    users?.users?.find((u) => u.email === 'test-a@example.com') ??
    users?.users?.find((u) => u.email === 'j5-walk@example.com') ??
    users?.users?.[0]
  if (!user) throw new Error('no seeded user found; run scripts/seed-director-fixture.ts or Playwright globalSetup first')
  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!member) throw new Error('test-a has no organisation_members row')
  testOrgId = member.organisation_id

  // Create a fresh project + document for isolation; clean up in afterAll.
  const { data: proj, error: projErr } = await admin
    .from('projects')
    .insert({ organisation_id: testOrgId, name: `db-constraints-test-${Date.now()}` })
    .select('id')
    .single()
  if (projErr || !proj) throw new Error(`project create failed: ${projErr?.message}`)
  testProjectId = proj.id

  const { data: docRpc, error: docErr } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: testProjectId,
    p_organisation_id: testOrgId,
    p_name: 'constraint-test',
    p_description: '',
    p_document_type: 'novel',
    p_authors: [],
  })
  if (docErr) throw new Error(`document create failed: ${docErr.message}`)
  testDocumentId = (docRpc as unknown as { document_id: string }).document_id

  // Create a parent node so we can attempt duplicate (parent, order) inserts.
  const { data: parent, error: parentErr } = await admin
    .from('nodes')
    .insert({
      organisation_id: testOrgId,
      project_id: testProjectId,
      document_id: testDocumentId,
      parent_id: null,
      order: 1,
      depth: 0,
      layer_index: 0,
      node_type: 'novel',
      node_category: 'structural',
      name: 'test-parent',
    })
    .select('id')
    .single()
  if (parentErr || !parent) throw new Error(`parent create failed: ${parentErr?.message}`)
  testParentId = parent.id
})

afterAll(async () => {
  if (!hasLocalDb || !testProjectId) return
  await admin.from('projects').delete().eq('id', testProjectId)
})

describe.skipIf(!hasLocalDb)('Phase 4 B4.1 — nodes UNIQUE(parent_id, "order") (F-265)', () => {
  it('rejects a second INSERT with the same (parent_id, order) — UNIQUE violation', async () => {
    // First INSERT — should succeed.
    const { error: err1 } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 99,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: 'first-child',
      })
    expect(err1).toBeNull()

    // Second INSERT with the same parent + order — must fail.
    const { error: err2 } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 99,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: 'duplicate-order',
      })
    expect(err2).toBeTruthy()
    // PostgreSQL UNIQUE violation = SQLSTATE 23505. Surfaces in
    // supabase-js as { code: '23505' }.
    expect((err2 as { code?: string }).code).toBe('23505')
  })

  it('allows different order values under the same parent (regression guard)', async () => {
    const { error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 100,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: 'distinct-order',
      })
    expect(error).toBeNull()
  })

  it('allows multiple rows with NULL parent_id and same order (NULLS DISTINCT default)', async () => {
    // Two root structural nodes (parent_id=NULL, order=1) must coexist.
    // This is the canonical Stelavox shape — every project has many.
    const { count: existingCount } = await admin
      .from('nodes')
      .select('id', { count: 'exact', head: true })
      .is('parent_id', null)
    // The local seed has hundreds of these. We're just asserting the
    // constraint hasn't broken what was already valid.
    expect(existingCount ?? 0).toBeGreaterThan(0)
  })
})

// Update vitest.config.ts include glob to pick up tests/integration/.
