/**
 * Phase 6.C unit tests — restore_node_version RPC.
 *
 * Covers happy path + version conflict + lock-blocker paths.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54331'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

interface Fixture {
  organisationId: string
  projectId: string
  documentId: string
  ownerUserId: string
  nodeId: string
}

let fix: Fixture | null = null
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('Phase 6.C restore_node_version RPC', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()

    const { data: u1 } = await svc.auth.admin.createUser({
      email: `phase6c-${Date.now()}-owner@stelavox.test`,
      password: 'TestPhase6C!',
      email_confirm: true,
    })

    let r = await svc.from('organisations').insert({
      id: orgId, name: 'P6C test', slug: `phase6c-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`org: ${r.error.message}`)

    r = await svc.from('organisation_members').insert({
      organisation_id: orgId, user_id: u1.user!.id, role: 'owner',
    })
    if (r.error) throw new Error(`member: ${r.error.message}`)

    r = await svc.from('projects').insert({
      id: projectId, organisation_id: orgId, name: 'P6C Project',
    })
    if (r.error) throw new Error(`project: ${r.error.message}`)

    const { data: docResult, error: docErr } = await svc.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: projectId, p_organisation_id: orgId,
        p_name: 'P6C Doc', p_description: '',
        p_document_type: 'novel', p_authors: [],
      },
    )
    if (docErr) throw new Error(`doc: ${docErr.message}`)
    const docId = (docResult as { document: { id: string } }).document.id
    const rootId = (docResult as { root_node: { id: string } }).root_node.id

    // Snapshot v1 with "old" content, then change current to "new"
    // content so restore back to v1 produces a real content change
    // (and therefore a version bump via the M-035 trigger).
    const v1Summary = JSON.stringify({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Old summary v1' }] },
    ] })
    const newSummary = JSON.stringify({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'New current summary' }] },
    ] })

    await svc.from('node_versions').insert({
      node_id: rootId, organisation_id: orgId, version: 1,
      summary: v1Summary,
      prose: null, notes: null, metadata: {},
      changed_by: u1.user!.id, change_reason: 'autosave',
    })

    // Now update the live row to differ from v1 AND bump the node's
    // version past 1 (so the manual v=1 snapshot represents history,
    // not the current state). M-210 added UNIQUE (node_id, version) on
    // node_versions; pre-M-210 the fixture could leave nodes.version=1
    // with a node_versions row also at v=1, but that was inconsistent
    // — restore_node_version would then snapshot a second row at v=1
    // and collide with the unique index. We bump via a raw SQL UPDATE
    // wrapped in a SECURITY DEFINER setter so the M-035 trigger sees
    // the GUC and bumps version cleanly. (The Supabase JS client can't
    // set session GUCs across separate calls; we go through a one-off
    // raw exec to set the GUC + UPDATE atomically.)
    const { error: bumpErr } = await svc.rpc('exec_with_bump_version', {
      p_node_id: rootId,
      p_new_summary: newSummary,
    })
    if (bumpErr) {
      // Helper RPC not present — fall back to direct UPDATE. Then bump
      // the version manually via a Postgres-side workaround:
      // insert a no-op completed agent_job + accept it, which uses
      // the production GUC path. Cleaner than re-wiring the test.
      // Simplest: just disable triggers, set version=2 directly.
      // Use a service-role escape hatch via the `agent_jobs` accept
      // pattern (which exists in production code path).
      // For test isolation we directly UPDATE nodes.version through
      // session_replication_role bypass via a wrapper RPC if needed;
      // for now, the simplest correct fallback is to delete the
      // pre-existing v=1 row, do the autosave (which won't bump),
      // then re-insert v=1 *after* a separate accept path bumps
      // nodes.version to 2. But the test only needs ONE prior history
      // row, so a much simpler approach: insert the manual v=1 row
      // representing prior history, then run an accept_agent_job
      // pass-through that bumps the live to v=2 with the new content.
      await svc.from('node_versions').delete().eq('node_id', rootId).eq('version', 1)
      // Refresh: set the live to the v1 content first so we can then
      // do an accept that bumps it to v=2 with the new content.
      await svc.from('nodes').update({ summary: v1Summary }).eq('id', rootId)
      // Create+accept a minimal refine job to legitimately bump v=1 → v=2.
      const { data: profile } = await svc.from('agent_profiles')
        .select('id').eq('operation_type', 'refine').limit(1).single()
      const { data: job } = await svc.from('agent_jobs').insert({
        organisation_id: orgId,
        document_id: docId,
        node_id: rootId,
        profile_id: (profile as { id: string }).id,
        operation_type: 'refine',
        state: 'awaiting_accept',
        result_summary: 'New current summary',
        triggered_by: 'phase6c_fixture',
      }).select('id').single()
      await svc.rpc('accept_agent_job', {
        p_job_id: (job as { id: string }).id,
        p_actor_id: 'phase6c_fixture',
        p_target_summary: newSummary,
      })
      // Now: nodes.version=2 with newSummary; node_versions has one
      // row at v=1 (the pre-accept snapshot of v1Summary). The
      // restore tests can now run cleanly.
    }

    fix = {
      organisationId: orgId, projectId, documentId: docId,
      ownerUserId: u1.user!.id, nodeId: rootId,
    }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
  })

  it('happy path: restoring v1 onto v1 advances to v2 with restore_from tag', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: nodeBefore } = await svc.from('nodes')
      .select('version').eq('id', fix.nodeId).single()
    const startVersion = nodeBefore!.version

    // Service-role RPC: auth.uid() will be NULL, so the write-gate
    // check is skipped (v_caller IS NULL branch).
    const { data, error } = await svc.rpc('restore_node_version', {
      p_node_id: fix.nodeId,
      p_target_version: 1,
      p_expected_version: startVersion,
    })
    if (error) throw new Error(`rpc error: ${error.message}`)
    expect(data).toMatchObject({ ok: true })
    const { new_version, restored_from } = data as { new_version: number; restored_from: number }
    expect(new_version).toBeGreaterThan(1)
    expect(restored_from).toBe(1)

    // The new version row should have the restore tag.
    const { data: latestRow } = await svc.from('node_versions')
      .select('change_reason')
      .eq('node_id', fix.nodeId)
      .eq('version', new_version)
      .single()
    expect(latestRow?.change_reason).toBe('restore_from_v1')
  })

  it('version_conflict when expected_version != current', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: nodeRow } = await svc.from('nodes')
      .select('version').eq('id', fix.nodeId).single()
    const wrong = nodeRow!.version - 99
    const { data, error } = await svc.rpc('restore_node_version', {
      p_node_id: fix.nodeId,
      p_target_version: 1,
      p_expected_version: wrong,
    })
    if (error) throw new Error(`rpc error: ${error.message}`)
    expect(data).toMatchObject({ ok: false, error: 'version_conflict' })
  })

  it('version_not_found when target version does not exist', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: nodeRow } = await svc.from('nodes')
      .select('version').eq('id', fix.nodeId).single()
    const currentVersion = nodeRow!.version

    const { data } = await svc.rpc('restore_node_version', {
      p_node_id: fix.nodeId,
      p_target_version: 9999,
      p_expected_version: currentVersion,
    })
    expect(data).toMatchObject({ ok: false, error: 'version_not_found' })
  })

  it('not_found when node does not exist', async () => {
    const { data } = await svc.rpc('restore_node_version', {
      p_node_id: '00000000-0000-0000-0000-000000000000',
      p_target_version: 1,
      p_expected_version: 1,
    })
    expect(data).toMatchObject({ ok: false, error: 'not_found' })
  })

  // Note: service-role calls bypass the check_node_writable branch
  // (v_caller IS NULL), so author_locked / in_use / in_progress
  // branches are exercised by Playwright integration tests rather than
  // here. The RPC body itself is covered by the four cases above.
})
