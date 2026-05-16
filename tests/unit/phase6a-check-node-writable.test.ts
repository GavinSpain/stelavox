/**
 * Phase 6.A unit tests — check_node_writable RPC + write-gate helpers.
 *
 * Validates the unified write-gate covers all three lock categories
 * with the priority order author_locked → node_in_use → node_in_progress.
 *
 * Talks directly to the local Supabase RPC via the service-role client
 * (RLS-bypass) so we exercise the SQL function shape without going
 * through HTTP routes.
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
  layerStackId: string
  ownerUserId: string
  otherUserId: string
  rootNodeId: string
  childNodeId: string
}

let fix: Fixture | null = null
const hasServiceKey = SERVICE_KEY !== ''

describe.skipIf(!hasServiceKey)('Phase 6.A check_node_writable RPC', () => {
  beforeAll(async () => {
    const orgId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    const childId = crypto.randomUUID()

    // Create two auth.users via the admin client.
    const { data: u1 } = await svc.auth.admin.createUser({
      email: `phase6a-${Date.now()}-owner@stelavox.test`,
      password: 'TestPhase6A!',
      email_confirm: true,
    })
    const { data: u2 } = await svc.auth.admin.createUser({
      email: `phase6a-${Date.now()}-other@stelavox.test`,
      password: 'TestPhase6A!',
      email_confirm: true,
    })

    const ownerUserId = u1.user!.id
    const otherUserId = u2.user!.id

    // Organisation + memberships.
    let r = await svc.from('organisations').insert({
      id: orgId, name: 'Phase6A test', slug: `phase6a-${Date.now()}`,
      plan: 'trial', token_allocation_credits: 1000000,
    })
    if (r.error) throw new Error(`insert org: ${r.error.message}`)
    r = await svc.from('organisation_members').insert([
      { organisation_id: orgId, user_id: ownerUserId, role: 'owner' },
      { organisation_id: orgId, user_id: otherUserId, role: 'member' },
    ])
    if (r.error) throw new Error(`insert members: ${r.error.message}`)

    r = await svc.from('projects').insert({
      id: projectId, organisation_id: orgId, name: 'P6A Project',
    })
    if (r.error) throw new Error(`insert project: ${r.error.message}`)

    // Document + root node + layer stack via the canonical RPC
    // (handles the deferrable cross-table FK ordering per M-077).
    const { data: docResult, error: docErr } = await svc.rpc(
      'create_document_with_layer_stack',
      {
        p_project_id: projectId,
        p_organisation_id: orgId,
        p_name: 'P6A Doc',
        p_description: '',
        p_document_type: 'novel',
        p_authors: [],
      },
    )
    if (docErr) throw new Error(`create_document_with_layer_stack: ${docErr.message}`)
    const docId = (docResult as { document_id: string }).document_id
    const rootId = (docResult as { root_node_id: string }).root_node_id

    // Add a single child for the lock-check tests.
    r = await svc.from('nodes').insert({
      id: childId, organisation_id: orgId, project_id: projectId, document_id: docId,
      node_category: 'structural', node_type: 'act', parent_id: rootId, order: 1, depth: 1, layer_index: 1,
      name: 'Act 1',
    })
    if (r.error) throw new Error(`insert child: ${r.error.message}`)

    fix = {
      organisationId: orgId, projectId, documentId: docId, layerStackId: '',
      ownerUserId, otherUserId, rootNodeId: rootId, childNodeId: childId,
    }
  }, 30_000)

  afterAll(async () => {
    if (!fix) return
    await svc.from('organisations').delete().eq('id', fix.organisationId)
    await svc.auth.admin.deleteUser(fix.ownerUserId)
    await svc.auth.admin.deleteUser(fix.otherUserId)
  })

  it('returns writable=true for an unlocked, unheld, unjobbed node', async () => {
    if (!fix) throw new Error('no fixture')
    const { data, error } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ writable: true, blocker: null, details: null })
  })

  it('returns author_locked when nodes.locked = TRUE (read source for 6.A; moves to node_author_locks in 6.B)', async () => {
    if (!fix) throw new Error('no fixture')
    await svc.from('nodes').update({ locked: true, lock_reason: 'test lock' }).eq('id', fix.childNodeId)

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: false, blocker: 'author_locked' })
    expect((data as { details: { reason: string } }).details.reason).toBe('test lock')

    await svc.from('nodes').update({ locked: false, lock_reason: null }).eq('id', fix.childNodeId)
  })

  it('returns node_in_use when another user has an Edit Session', async () => {
    if (!fix) throw new Error('no fixture')
    const future = new Date(Date.now() + 5 * 60_000).toISOString()
    await svc.from('node_locks').insert({
      node_id: fix.childNodeId,
      organisation_id: fix.organisationId,
      user_id: fix.otherUserId,
      expires_at: future,
    })

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: false, blocker: 'node_in_use' })

    await svc.from('node_locks').delete().eq('node_id', fix.childNodeId)
  })

  it('does NOT block when the SAME user holds the Edit Session', async () => {
    if (!fix) throw new Error('no fixture')
    const future = new Date(Date.now() + 5 * 60_000).toISOString()
    await svc.from('node_locks').insert({
      node_id: fix.childNodeId,
      organisation_id: fix.organisationId,
      user_id: fix.ownerUserId,
      expires_at: future,
    })

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: true, blocker: null })

    await svc.from('node_locks').delete().eq('node_id', fix.childNodeId)
  })

  it('returns node_in_progress when an agent_job has queue_status=queued', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: job, error: jobErr } = await svc.from('agent_jobs').insert({
      organisation_id: fix.organisationId,
      document_id: fix.documentId,
      node_id: fix.childNodeId,
      operation_type: 'expand',
      operation_class: 'single_node',
      status: 'pending',
      queue_status: 'queued',
      triggered_by: 'user',
      profile_id: null,
    }).select('id').single()
    if (jobErr) throw new Error(`agent_jobs insert: ${jobErr.message}`)

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: false, blocker: 'node_in_progress' })

    await svc.from('agent_jobs').delete().eq('id', job!.id)
  })

  it('returns node_in_progress for status=completed (review-pending — indefinite per D6)', async () => {
    if (!fix) throw new Error('no fixture')
    const { data: job, error: jobErr } = await svc.from('agent_jobs').insert({
      organisation_id: fix.organisationId,
      document_id: fix.documentId,
      node_id: fix.childNodeId,
      operation_type: 'expand',
      operation_class: 'single_node',
      status: 'completed',
      queue_status: 'completed',
      triggered_by: 'user',
      profile_id: null,
    }).select('id').single()
    if (jobErr) throw new Error(`agent_jobs insert: ${jobErr.message}`)

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: false, blocker: 'node_in_progress' })

    await svc.from('agent_jobs').delete().eq('id', job!.id)
  })

  it('does NOT block on agent_jobs in terminal states (accepted / dismissed / cancelled / failed)', async () => {
    if (!fix) throw new Error('no fixture')
    for (const status of ['accepted', 'dismissed', 'cancelled', 'failed']) {
      const { data: job, error: jobErr } = await svc.from('agent_jobs').insert({
        organisation_id: fix.organisationId,
        document_id: fix.documentId,
        node_id: fix.childNodeId,
        operation_type: 'expand',
        operation_class: 'single_node',
        status,
        queue_status: status === 'failed' ? 'failed' : status === 'cancelled' ? 'cancelled' : 'completed',
        triggered_by: 'user',
        profile_id: null,
      }).select('id').single()
      if (jobErr) throw new Error(`agent_jobs insert (status=${status}): ${jobErr.message}`)

      const { data } = await svc.rpc('check_node_writable', {
        p_node_id: fix.childNodeId,
        p_requesting_user_id: fix.ownerUserId,
      })
      expect(data, `terminal status=${status} should not block`).toMatchObject({ writable: true })

      await svc.from('agent_jobs').delete().eq('id', job!.id)
    }
  })

  it('priority: author_locked beats node_in_use beats node_in_progress', async () => {
    if (!fix) throw new Error('no fixture')

    // Set up all three blockers simultaneously.
    await svc.from('nodes').update({ locked: true }).eq('id', fix.childNodeId)
    const future = new Date(Date.now() + 5 * 60_000).toISOString()
    await svc.from('node_locks').insert({
      node_id: fix.childNodeId, organisation_id: fix.organisationId,
      user_id: fix.otherUserId, expires_at: future,
    })
    const { data: job, error: jobErr } = await svc.from('agent_jobs').insert({
      organisation_id: fix.organisationId,
      document_id: fix.documentId,
      node_id: fix.childNodeId,
      operation_type: 'expand',
      operation_class: 'single_node',
      status: 'pending',
      queue_status: 'queued',
      triggered_by: 'user',
      profile_id: null,
    }).select('id').single()
    if (jobErr) throw new Error(`agent_jobs insert: ${jobErr.message}`)

    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(data).toMatchObject({ writable: false, blocker: 'author_locked' })

    // Now remove author lock; node_in_use should win.
    await svc.from('nodes').update({ locked: false }).eq('id', fix.childNodeId)
    const { data: d2 } = await svc.rpc('check_node_writable', {
      p_node_id: fix.childNodeId,
      p_requesting_user_id: fix.ownerUserId,
    })
    expect(d2).toMatchObject({ writable: false, blocker: 'node_in_use' })

    // Cleanup.
    await svc.from('node_locks').delete().eq('node_id', fix.childNodeId)
    await svc.from('agent_jobs').delete().eq('id', job!.id)
  })

  it('returns not_found for a non-existent node', async () => {
    const { data } = await svc.rpc('check_node_writable', {
      p_node_id: '00000000-0000-0000-0000-000000000000',
      p_requesting_user_id: fix?.ownerUserId ?? '00000000-0000-0000-0000-000000000001',
    })
    expect(data).toMatchObject({ writable: false, blocker: 'not_found' })
  })
})
