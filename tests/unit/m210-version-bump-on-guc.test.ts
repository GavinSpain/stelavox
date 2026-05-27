/**
 * M-210 — bump_node_version_on_content_change trigger: GUC-first invariant.
 *
 * Pre-M-210 the trigger required BOTH the session GUC
 * `stelavox.bump_version='true'` AND a real content delta to bump
 * nodes.version. When `accept_agent_job` applied content that happened
 * to be byte-identical to what was already on the node, the trigger
 * silently skipped the bump — despite the caller's explicit intent.
 * The accept-side snapshot INSERT ran unconditionally, so duplicate
 * (node_id, version) snapshot rows accumulated. UI lookups via
 * .maybeSingle() then errored on the duplicates.
 *
 * Post-M-210 the trigger honours the GUC unconditionally. The caller
 * is the source of truth for "is this a version-bump-worthy event"
 * — the trigger no longer second-guesses via byte comparison.
 *
 * Layer 3 invariants exercised here:
 *
 *   1. GUC set + content changed             → version bumps (regression sanity)
 *   2. GUC set + content IDENTICAL           → version STILL bumps (M-210 fix)
 *   3. GUC unset + content changed (autosave) → version stays, content_revision bumps
 *   4. GUC unset + content identical          → both stay
 *   5. UNIQUE (node_id, version) backstop fires on duplicate insert attempt
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
const hasServiceKey = SERVICE_KEY !== ''

interface Fixture {
  orgId: string
  projectId: string
  documentId: string
  beatId: string
  ownerUserId: string
}

let fix: Fixture | null = null

function tiptapDoc(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  }
}

async function readState(nodeId: string): Promise<{ version: number; content_revision: number }> {
  const { data, error } = await svc
    .from('nodes')
    .select('version, content_revision')
    .eq('id', nodeId)
    .single()
  if (error || !data) throw new Error(`readState: ${error?.message ?? 'no row'}`)
  return data as { version: number; content_revision: number }
}

/**
 * Apply an UPDATE through a SECURITY DEFINER helper that controls the
 * `stelavox.bump_version` GUC explicitly. The trigger reads the GUC at
 * BEFORE-UPDATE time. We invoke the GUC + UPDATE pair from a single SQL
 * statement so the GUC value is in scope during the trigger.
 *
 * We use a one-off ad-hoc `rpc('exec_sql', ...)` would be the easy way,
 * but no such RPC is exposed in this codebase. Instead we apply the UPDATE
 * directly via `svc.from('nodes').update()` and emulate the GUC by calling
 * a small migration-defined helper. Since we don't have one, we exercise
 * the GUC path through `accept_agent_job` (the real production caller)
 * and the no-GUC path through a plain `.update()` — which mirrors how
 * autosave PATCH actually writes.
 */

async function applyAcceptViaRpc(
  jobId: string,
  targetProse: string,
): Promise<void> {
  const { error } = await svc.rpc('accept_agent_job', {
    p_job_id: jobId,
    p_actor_id: 'm210_test',
    p_target_prose: targetProse,
  })
  if (error) throw new Error(`accept_agent_job: ${error.message}`)
}

async function seedAcceptableJob(nodeId: string, plainResultProse: string): Promise<string> {
  const { data: profileRow } = await svc
    .from('agent_profiles')
    .select('id')
    .eq('operation_type', 'refine')
    .limit(1)
    .single()
  if (!profileRow) throw new Error('no refine profile seeded')

  const { data: job, error } = await svc
    .from('agent_jobs')
    .insert({
      organisation_id: fix!.orgId,
      document_id: fix!.documentId,
      node_id: nodeId,
      profile_id: (profileRow as { id: string }).id,
      operation_type: 'refine',
      // 'awaiting_accept' → legacy status='completed' (accept_agent_job's required precondition)
      state: 'awaiting_accept',
      result_prose: plainResultProse,
      triggered_by: 'm210_test',
    })
    .select('id')
    .single()
  if (error || !job) throw new Error(`agent_job insert: ${error?.message ?? 'no row'}`)
  return (job as { id: string }).id
}

async function insertBeat(prose: unknown): Promise<string> {
  if (!fix) throw new Error('fixture not initialised')
  const { data: scene } = await svc
    .from('nodes')
    .select('id, layer_index, depth')
    .eq('document_id', fix.documentId)
    .eq('node_type', 'scene')
    .limit(1)
    .single()
  if (!scene) throw new Error('no scene under fixture document')
  const sceneRow = scene as { id: string; layer_index: number; depth: number }
  const beatId = crypto.randomUUID()
  const { error } = await svc.from('nodes').insert({
    id: beatId,
    organisation_id: fix.orgId,
    project_id: fix.projectId,
    document_id: fix.documentId,
    parent_id: sceneRow.id,
    node_category: 'structural',
    node_type: 'beat',
    layer_index: sceneRow.layer_index + 1,
    depth: sceneRow.depth + 1,
    order: Math.floor(Math.random() * 100000),
    name: 'M-210 test beat',
    status: 'draft',
    prose,
    created_by: fix.ownerUserId,
    last_modified_by: fix.ownerUserId,
    scope: null,
  })
  if (error) throw new Error(`beat insert: ${error.message}`)
  return beatId
}

describe.skipIf(!hasServiceKey)('M-210 — version-bump trigger GUC-first', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()

    const { data: user, error: userErr } = await svc.auth.admin.createUser({
      email: `m210-${Date.now()}@test.local`,
      password: 'Test1234!Test1234!',
      email_confirm: true,
    })
    if (userErr || !user.user) throw new Error(`user: ${userErr?.message ?? 'no user'}`)

    let r = await svc.from('organisations').insert({
      id: orgId,
      name: 'M-210 Test Org',
      slug: `m210-${Date.now()}`,
      plan: 'trial',
      token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert({
      organisation_id: orgId,
      user_id: user.user.id,
      role: 'owner',
    })
    if (r.error) throw new Error(`member: ${r.error.message}`)
    r = await svc.from('projects').insert({ id: projectId, organisation_id: orgId, name: 'M-210 Test Project' })
    if (r.error) throw new Error(`project: ${r.error.message}`)

    const { data: docResult, error: docErr } = await svc.rpc('create_document_with_layer_stack', {
      p_project_id: projectId,
      p_organisation_id: orgId,
      p_name: 'M-210 Test Document',
      p_description: 'test fixture',
      p_document_type: 'novel',
      p_authors: ['M-210 test'],
    })
    if (docErr) throw new Error(`create_document: ${docErr.message}`)
    // The RPC's RETURNS JSONB shape is `{ document: {...}, root_node: {...}, ... }`
    // (see M-085). The Supabase JS client returns the JSON as-is, so we
    // pull the nested ids explicitly.
    const docResultObj = docResult as {
      document: { id: string }
      root_node: { id: string }
    }
    const documentId = docResultObj.document.id
    const rootId = docResultObj.root_node.id

    // Seed scaffold: act → chapter → scene under the document root so
    // a beat (layer 4) can be parented under a scene (layer 3).
    const actId = crypto.randomUUID()
    const chapterId = crypto.randomUUID()
    const sceneId = crypto.randomUUID()
    const scaffold = await svc.from('nodes').insert([
      {
        id: actId, organisation_id: orgId, project_id: projectId, document_id: documentId,
        parent_id: rootId, node_category: 'structural', node_type: 'act',
        layer_index: 1, depth: 1, order: 1, name: 'Act 1',
        status: 'draft', created_by: user.user.id, last_modified_by: user.user.id, scope: null,
      },
      {
        id: chapterId, organisation_id: orgId, project_id: projectId, document_id: documentId,
        parent_id: actId, node_category: 'structural', node_type: 'chapter',
        layer_index: 2, depth: 2, order: 1, name: 'Chapter 1',
        status: 'draft', created_by: user.user.id, last_modified_by: user.user.id, scope: null,
      },
      {
        id: sceneId, organisation_id: orgId, project_id: projectId, document_id: documentId,
        parent_id: chapterId, node_category: 'structural', node_type: 'scene',
        layer_index: 3, depth: 3, order: 1, name: 'Scene 1',
        status: 'draft', created_by: user.user.id, last_modified_by: user.user.id, scope: null,
      },
    ])
    if (scaffold.error) throw new Error(`scaffold: ${scaffold.error.message}`)

    fix = { orgId, projectId, documentId, beatId: '', ownerUserId: user.user.id }
  })

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.orgId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  it('1. GUC set + content changed → version bumps (sanity)', async () => {
    const beatId = await insertBeat(tiptapDoc('initial'))
    const before = await readState(beatId)
    const targetProse = JSON.stringify(tiptapDoc('changed content'))
    const jobId = await seedAcceptableJob(beatId, 'changed content')
    await applyAcceptViaRpc(jobId, targetProse)
    const after = await readState(beatId)
    expect(after.version).toBe(before.version + 1)
    expect(after.content_revision).toBe(before.content_revision + 1)
  })

  it('2. GUC set + content IDENTICAL → version STILL bumps (M-210 fix)', async () => {
    const proseDoc = tiptapDoc('identical')
    const beatId = await insertBeat(proseDoc)
    const before = await readState(beatId)
    const targetProse = JSON.stringify(proseDoc)
    const jobId = await seedAcceptableJob(beatId, 'identical')
    await applyAcceptViaRpc(jobId, targetProse)
    const after = await readState(beatId)
    expect(after.version).toBe(before.version + 1)
    expect(after.content_revision).toBe(before.content_revision + 1)
  })

  it('3. GUC unset + content changed (autosave path) → version stays, content_revision bumps', async () => {
    const beatId = await insertBeat(tiptapDoc('autosave-initial'))
    const before = await readState(beatId)
    // Direct .update() — no GUC set. Mirrors PATCH /api/nodes/[id] semantics.
    const { error } = await svc
      .from('nodes')
      .update({ prose: tiptapDoc('autosave-changed') })
      .eq('id', beatId)
    if (error) throw new Error(`autosave: ${error.message}`)
    const after = await readState(beatId)
    expect(after.version).toBe(before.version)
    expect(after.content_revision).toBe(before.content_revision + 1)
  })

  it('4. GUC unset + content identical → both stay', async () => {
    const proseDoc = tiptapDoc('autosave-noop')
    const beatId = await insertBeat(proseDoc)
    const before = await readState(beatId)
    const { error } = await svc
      .from('nodes')
      .update({ prose: proseDoc })
      .eq('id', beatId)
    if (error) throw new Error(`autosave-noop: ${error.message}`)
    const after = await readState(beatId)
    expect(after.version).toBe(before.version)
    expect(after.content_revision).toBe(before.content_revision)
  })

  it('5. UNIQUE (node_id, version) backstop rejects a duplicate-version insert', async () => {
    const beatId = await insertBeat(tiptapDoc('backstop'))
    // Insert a snapshot at v=1 directly (bypassing accept_agent_job).
    let r = await svc.from('node_versions').insert({
      node_id: beatId,
      organisation_id: fix!.orgId,
      version: 1,
      prose: tiptapDoc('first'),
      changed_by: 'm210_test',
      change_reason: 'agent_synthesise',
    })
    if (r.error) throw new Error(`first insert: ${r.error.message}`)
    // Attempt a second snapshot at the same version — must be rejected by
    // the M-210 UNIQUE constraint.
    r = await svc.from('node_versions').insert({
      node_id: beatId,
      organisation_id: fix!.orgId,
      version: 1,
      prose: tiptapDoc('duplicate'),
      changed_by: 'm210_test',
      change_reason: 'agent_refine',
    })
    expect(r.error).not.toBeNull()
    expect(r.error?.message ?? '').toMatch(/node_versions_node_id_version_unique|duplicate key/i)
  })

  it('6. accept_agent_job skips snapshot for expand operations (M-210)', async () => {
    if (!fix) throw new Error('fix not init')
    // Pick a chapter that already has at least one child (scene) so the
    // layer lookup in accept_agent_job succeeds.
    const { data: chapter } = await svc
      .from('nodes')
      .select('id')
      .eq('document_id', fix.documentId)
      .eq('node_type', 'chapter')
      .limit(1)
      .single()
    const chapterId = (chapter as { id: string }).id

    const beforeSnaps = await svc
      .from('node_versions')
      .select('*', { count: 'exact', head: true })
      .eq('node_id', chapterId)

    const { data: expandProfile } = await svc
      .from('agent_profiles')
      .select('id')
      .eq('operation_type', 'expand')
      .limit(1)
      .single()

    const { data: job } = await svc
      .from('agent_jobs')
      .insert({
        organisation_id: fix.orgId,
        document_id: fix.documentId,
        node_id: chapterId,
        profile_id: (expandProfile as { id: string }).id,
        operation_type: 'expand',
        state: 'awaiting_accept',
        triggered_by: 'm210_test',
      })
      .select('id')
      .single()

    await svc.rpc('accept_agent_job', {
      p_job_id: (job as { id: string }).id,
      p_actor_id: 'm210_test',
      p_child_nodes: [
        { name: 'M-210 expand child', short_description: 'x', summary: JSON.stringify(tiptapDoc('child')), position: 99 },
      ],
    })

    const afterSnaps = await svc
      .from('node_versions')
      .select('*', { count: 'exact', head: true })
      .eq('node_id', chapterId)

    expect(afterSnaps.count ?? 0).toBe(beforeSnaps.count ?? 0)
  })
})
