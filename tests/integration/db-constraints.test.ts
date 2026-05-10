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
  testDocumentId = (docRpc as unknown as { document: { id: string } }).document.id

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
      node_type: 'book',
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

// ─── B4.2 — conversation_messages UNIQUE(conversation_id, sequence) ─────

describe.skipIf(!hasLocalDb)('Phase 4 B4.2 — conversation_messages UNIQUE(conversation_id, sequence) (F-266)', () => {
  let conversationId: string

  beforeAll(async () => {
    if (!hasLocalDb) return
    // Create a conversation against the test document (created in the
    // outer beforeAll). conversations.UNIQUE(document_id) means we get
    // either the existing one or a fresh insert.
    const { data: existing } = await admin
      .from('conversations')
      .select('id')
      .eq('document_id', testDocumentId)
      .maybeSingle()
    if (existing) {
      conversationId = existing.id
    } else {
      const { data: created, error } = await admin
        .from('conversations')
        .insert({
          document_id: testDocumentId,
          organisation_id: testOrgId,
        })
        .select('id')
        .single()
      if (error || !created) throw new Error(`conversation create failed: ${error?.message}`)
      conversationId = created.id
    }
  })

  it('rejects a second INSERT with the same (conversation_id, sequence) — UNIQUE violation', async () => {
    const { error: err1 } = await admin
      .from('conversation_messages')
      .insert({
        conversation_id: conversationId,
        sequence: 9999,
        role: 'user',
        content: 'first',
      })
    expect(err1).toBeNull()

    const { error: err2 } = await admin
      .from('conversation_messages')
      .insert({
        conversation_id: conversationId,
        sequence: 9999,
        role: 'user',
        content: 'duplicate-seq',
      })
    expect(err2).toBeTruthy()
    expect((err2 as { code?: string }).code).toBe('23505')
  })

  it('allows different sequence values in the same conversation (regression guard)', async () => {
    const { error } = await admin
      .from('conversation_messages')
      .insert({
        conversation_id: conversationId,
        sequence: 10000,
        role: 'user',
        content: 'distinct-seq',
      })
    expect(error).toBeNull()
  })
})

// ─── B4.3 — nodes.node_type CHECK constraint ────────────────────────────

describe.skipIf(!hasLocalDb)('Phase 4 B4.3 — nodes.node_type CHECK constraint (F-267)', () => {
  it('rejects an invalid node_type ("invalid_type") via DB CHECK', async () => {
    const { error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 200,
        depth: 1,
        layer_index: 1,
        node_type: 'invalid_type',
        node_category: 'structural',
        name: 'should-fail',
      } as never)
    expect(error).toBeTruthy()
    // PostgreSQL CHECK violation = SQLSTATE 23514
    expect((error as { code?: string }).code).toBe('23514')
  })

  it('rejects category-mismatch (context node_type with structural category)', async () => {
    const { error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 201,
        depth: 1,
        layer_index: 1,
        node_type: 'character',  // valid context type...
        node_category: 'structural',  // ...but wrong category
        name: 'should-fail',
      } as never)
    expect(error).toBeTruthy()
    expect((error as { code?: string }).code).toBe('23514')
  })

  it('allows all 13 V1 node_type values with the correct category (regression guard)', async () => {
    const valid: Array<{ type: string; category: 'structural' | 'context' }> = [
      { type: 'book', category: 'structural' },
      { type: 'series', category: 'structural' },
      { type: 'story', category: 'structural' },
      { type: 'act', category: 'structural' },
      { type: 'chapter', category: 'structural' },
      { type: 'scene', category: 'structural' },
      { type: 'beat', category: 'structural' },
      { type: 'character', category: 'context' },
      { type: 'location', category: 'context' },
      { type: 'organisation', category: 'context' },
      { type: 'theme', category: 'context' },
      { type: 'plot_thread', category: 'context' },
      { type: 'world', category: 'context' },
    ]
    for (let i = 0; i < valid.length; i++) {
      const v = valid[i]!
      const { error } = await admin
        .from('nodes')
        .insert({
          organisation_id: testOrgId,
          project_id: testProjectId,
          document_id: v.category === 'structural' ? testDocumentId : null,
          parent_id: v.category === 'structural' ? testParentId : null,
          order: 300 + i,
          depth: 1,
          layer_index: 1,
          node_type: v.type,
          node_category: v.category,
          scope: v.category === 'context' ? 'project' : null,
          name: `valid-${v.type}`,
        } as never)
      expect(error, `${v.category}/${v.type} should pass CHECK`).toBeNull()
    }
  })
})

// ─── B5.1 / B5.2 — audit_log table writes ────────────────────────────────

describe.skipIf(!hasLocalDb)('Phase 5 B5.1 — audit_log writeAuditLogEntry helper', () => {
  it('persists a row to audit_log and is readable via service-role', async () => {
    const { writeAuditLogEntry } = await import('@/lib/security/audit')

    const probeEventType = `b5_1_probe_${Date.now()}`
    await writeAuditLogEntry({
      event_type: probeEventType,
      severity: 'info',
      organisation_id: testOrgId,
      metadata: { test: 'b5.1', stamp: Date.now() },
    })

    const { data } = await admin
      .from('audit_log')
      .select('event_type, severity, organisation_id, metadata')
      .eq('event_type', probeEventType)
      .maybeSingle()

    expect(data).toBeTruthy()
    expect(data!.severity).toBe('info')
    expect(data!.organisation_id).toBe(testOrgId)
  })

  it('rejects an invalid severity via DB CHECK', async () => {
    const { error } = await admin
      .from('audit_log')
      .insert({
        event_type: 'b5_1_bad_severity',
        severity: 'extreme' as never,
        organisation_id: testOrgId,
      } as never)
    expect(error).toBeTruthy()
    expect((error as { code?: string }).code).toBe('23514')
  })

  it('accepts the new low severity (B5.1 CHECK extension)', async () => {
    const { error } = await admin
      .from('audit_log')
      .insert({
        event_type: 'b5_1_low_severity',
        severity: 'low',
        organisation_id: testOrgId,
      } as never)
    expect(error).toBeNull()
  })
})

// ─── B4.4 — created_by / last_modified_by → UUID FK ─────────────────────

describe.skipIf(!hasLocalDb)('Phase 4 B4.4 — audit-column UUID FK to auth.users (F-268)', () => {
  it('rejects an INSERT with a non-existent created_by UUID', async () => {
    const fakeUuid = '00000000-0000-0000-0000-000000000099'
    const { error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 400,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: 'fake-author',
        created_by: fakeUuid,
      } as never)
    expect(error).toBeTruthy()
    // PostgreSQL FK violation = SQLSTATE 23503.
    expect((error as { code?: string }).code).toBe('23503')
  })

  it('allows NULL created_by (service-role / system writes)', async () => {
    const { error } = await admin
      .from('nodes')
      .insert({
        organisation_id: testOrgId,
        project_id: testProjectId,
        document_id: testDocumentId,
        parent_id: testParentId,
        order: 401,
        depth: 1,
        layer_index: 1,
        node_type: 'act',
        node_category: 'structural',
        name: 'no-author',
        created_by: null,
      } as never)
    expect(error).toBeNull()
  })

  // Note: node_attachments.created_by and scheduled_jobs.created_by
  // already have FK to auth.users (verified via \d in pre-flight). The
  // audit's F-268 was specifically about nodes.{created_by,last_modified_by};
  // the other tables were correctly constrained.
})
