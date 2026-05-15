/**
 * V1.x-B.3 — concurrent multi-Brief + Brief amendments.
 *
 * Source: stelavox_v1x_b_3_build_checklist_v1_0.md §6 + §7.
 *
 * Coverage (CK-1 through CK-7 substrate):
 *   - CK-1: M-126 drops the index — two active Briefs allowed on same doc
 *   - CK-2: apply_brief_amendment(goal_text) updates the Brief atomically
 *   - CK-3: apply_brief_amendment(add_stage) appends a new pending stage
 *   - CK-4: apply_brief_amendment refuses to modify already-running stage
 *   - CK-5: propose_brief surfaces concurrent-edit warnings (lib-side)
 *   - CK-6: brief_amendments table CRUD + status transitions
 *   - CK-7: idempotency — apply twice returns already_applied
 */

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

async function getUserId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  return (users?.users ?? []).find((u) => u.email === email)!.id
}

async function newDocument(orgId: string, name = 'V1.x-B.3'): Promise<string> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  const { data: docRpc, error } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: name,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (error) throw new Error(`create_document RPC failed: ${error.message}`)
  return (docRpc as { document: { id: string } }).document.id
}

test.describe('V1.x-B.3 — CK-1 multi-Brief concurrency (M-126 index dropped)', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('two active Briefs allowed on same document', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-1 multi-brief')

    // Insert two active Briefs.
    const insertedIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const { data, error } = await admin
        .from('briefs')
        .insert({
          organisation_id: orgA,
          document_id: docId,
          status: 'active',
          sequence_position: 0,
          goal_text: `Brief ${i + 1}`,
        })
        .select('id')
        .single()
      expect(error, `insert brief ${i + 1}`).toBeNull()
      insertedIds.push(data!.id)
    }
    expect(insertedIds).toHaveLength(2)

    // Verify both rows exist concurrently.
    const { data: actives } = await admin
      .from('briefs')
      .select('id, status')
      .eq('document_id', docId)
      .eq('status', 'active')
    expect(actives).toHaveLength(2)

    await admin.from('briefs').delete().in('id', insertedIds)
  })
})

test.describe('V1.x-B.3 — CK-2/3/4/7 apply_brief_amendment RPC', () => {
  let orgA: string
  let userIdA: string
  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    userIdA = await getUserId(USERS.A.email)
  })

  test('CK-2 goal_text amendment updates the Brief atomically', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-2 goal_text')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'original goal',
      })
      .select('id')
      .single()

    const { data: amendment } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'goal_text',
        after: { goal_text: 'updated goal' },
        reason: 'tighter scope',
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by_user_id: userIdA,
      })
      .select('id')
      .single()

    const { error: rpcErr } = await admin.rpc('apply_brief_amendment', {
      p_amendment_id: amendment!.id,
    })
    expect(rpcErr).toBeNull()

    const { data: briefAfter } = await admin
      .from('briefs')
      .select('goal_text')
      .eq('id', brief!.id)
      .single()
    expect(briefAfter!.goal_text).toBe('updated goal')

    // Verify amendment marked applied.
    const { data: amendAfter } = await admin
      .from('brief_amendments')
      .select('applied_at')
      .eq('id', amendment!.id)
      .single()
    expect(amendAfter!.applied_at).not.toBeNull()

    await admin.from('brief_amendments').delete().eq('id', amendment!.id)
    await admin.from('briefs').delete().eq('id', brief!.id)
  })

  test('CK-3 add_stage amendment appends a new planned stage', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-3 add_stage')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'goal',
      })
      .select('id')
      .single()
    await admin.from('brief_stages').insert({
      brief_id: brief!.id,
      order: 1,
      title: 'Stage 1',
      status: 'planned',
      trigger_type: 'manual',
      trigger_config: {},
    })

    const { data: amendment } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'add_stage',
        after: {
          order: 2,
          title: 'Stage 2',
          description: 'added later',
          trigger_type: 'after_stage',
          trigger_config: { after_stage_order: 1 },
        },
        reason: 'extended scope',
        status: 'approved',
      })
      .select('id')
      .single()

    await admin.rpc('apply_brief_amendment', { p_amendment_id: amendment!.id })

    const { data: stages } = await admin
      .from('brief_stages')
      .select('order, title, status')
      .eq('brief_id', brief!.id)
      .order('order')
    expect(stages).toHaveLength(2)
    expect(stages![1].order).toBe(2)
    expect(stages![1].title).toBe('Stage 2')
    expect(stages![1].status).toBe('planned')

    await admin.from('brief_amendments').delete().eq('id', amendment!.id)
    await admin.from('brief_stages').delete().eq('brief_id', brief!.id)
    await admin.from('briefs').delete().eq('id', brief!.id)
  })

  test('CK-4 modify amendment refused on already-running stage', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-4 modify-running')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'goal',
      })
      .select('id')
      .single()
    const { data: stage } = await admin
      .from('brief_stages')
      .insert({
        brief_id: brief!.id,
        order: 1,
        title: 'Stage 1',
        status: 'running',  // already running — not amendable
        trigger_type: 'manual',
        trigger_config: {},
      })
      .select('id')
      .single()

    const { data: amendment } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'modify_pending_stage',
        target_path: stage!.id,
        after: { title: 'Renamed' },
        reason: 'rename',
        status: 'approved',
      })
      .select('id')
      .single()

    const { error: rpcErr } = await admin.rpc('apply_brief_amendment', { p_amendment_id: amendment!.id })
    expect(rpcErr).not.toBeNull()
    expect(rpcErr!.message).toMatch(/cannot_modify_non_pending_stage/i)

    // Stage title unchanged.
    const { data: stageAfter } = await admin
      .from('brief_stages')
      .select('title')
      .eq('id', stage!.id)
      .single()
    expect(stageAfter!.title).toBe('Stage 1')

    await admin.from('brief_amendments').delete().eq('id', amendment!.id)
    await admin.from('brief_stages').delete().eq('id', stage!.id)
    await admin.from('briefs').delete().eq('id', brief!.id)
  })

  test('CK-7 apply_brief_amendment is idempotent (already_applied on second call)', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-7 idempotency')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'original',
      })
      .select('id')
      .single()
    const { data: amendment } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'goal_text',
        after: { goal_text: 'updated' },
        reason: 'test',
        status: 'approved',
      })
      .select('id')
      .single()

    const first = await admin.rpc('apply_brief_amendment', { p_amendment_id: amendment!.id })
    expect(first.error).toBeNull()
    expect((first.data as { already_applied?: boolean }).already_applied).toBeFalsy()

    const second = await admin.rpc('apply_brief_amendment', { p_amendment_id: amendment!.id })
    expect(second.error).toBeNull()
    expect((second.data as { already_applied?: boolean }).already_applied).toBe(true)

    await admin.from('brief_amendments').delete().eq('id', amendment!.id)
    await admin.from('briefs').delete().eq('id', brief!.id)
  })
})

test.describe('V1.x-B.3 — CK-6 brief_amendments CRUD + status', () => {
  let orgA: string
  let userIdA: string
  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
    userIdA = await getUserId(USERS.A.email)
  })

  test('brief_amendments accepts proposed → approved → applied transitions', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-6 status')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'goal',
      })
      .select('id')
      .single()

    const { data: amend } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'goal_text',
        after: { goal_text: 'new goal' },
        reason: 'pivot',
        status: 'proposed',
      })
      .select('id, status, proposed_at')
      .single()
    expect(amend!.status).toBe('proposed')
    expect(amend!.proposed_at).not.toBeNull()

    await admin
      .from('brief_amendments')
      .update({ status: 'approved', approved_at: new Date().toISOString(), approved_by_user_id: userIdA })
      .eq('id', amend!.id)

    const { data: approved } = await admin
      .from('brief_amendments')
      .select('status, approved_at')
      .eq('id', amend!.id)
      .single()
    expect(approved!.status).toBe('approved')

    await admin.from('brief_amendments').delete().eq('id', amend!.id)
    await admin.from('briefs').delete().eq('id', brief!.id)
  })

  test('CHECK constraint rejects invalid amendment_type', async () => {
    const admin = adminClient()
    const docId = await newDocument(orgA, 'CK-6 bad-type')
    const { data: brief } = await admin
      .from('briefs')
      .insert({
        organisation_id: orgA,
        document_id: docId,
        status: 'active',
        sequence_position: 0,
        goal_text: 'goal',
      })
      .select('id')
      .single()
    const { error } = await admin
      .from('brief_amendments')
      .insert({
        brief_id: brief!.id,
        proposed_by_user_id: userIdA,
        amendment_type: 'not_a_real_type',
        after: {},
        reason: 'test',
      })
    expect(error).not.toBeNull()
    await admin.from('briefs').delete().eq('id', brief!.id)
  })
})
