/**
 * V1.x-B.1.1 — Scheduler / queue / status API Playwright integration spec.
 *
 * End-to-end verification of the new API surface:
 *   - CK-3: sequential multi-Brief queue (accept_brief queues when active exists)
 *   - GET /api/scheduler/queue (paginated tree shape)
 *   - POST /api/scheduler/jobs/[id]/cancel (best-effort)
 *   - POST /api/scheduler/jobs/[id]/intent (immediate ↔ scheduled ↔ parked)
 *   - POST /api/scheduler/jobs/[id]/reschedule
 *   - POST /api/brief/queue/reorder (atomic two-pass UPDATE)
 *   - POST /api/brief/[id]/cancel (cascade summary + auto-promote)
 *   - GET /api/status/pending-attention
 *   - GET /api/status/document/[id]/pending-director
 *
 * Each test is independent — set up its own document where needed; tear
 * down on completion. The tests don't share Brief state to avoid
 * partial-unique-index conflicts.
 */

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

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

async function newDocument(orgId: string, name: string): Promise<{ projectId: string; documentId: string }> {
  const { data: project } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name })
    .select()
    .single()
  const projectId = project!.id

  const { data: doc, error } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: name,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  if (error) throw new Error(`RPC failed: ${error.message}`)
  const result = doc as unknown as { document: { id: string } }
  return { projectId, documentId: result.document.id }
}

async function acceptBriefDirect(
  documentId: string,
  goalText: string,
): Promise<{ briefId: string; initialStatus: string; queuePosition: number }> {
  const { data, error } = await adminClient().rpc('accept_brief', {
    p_document_id: documentId,
    p_goal_text: goalText,
    p_stages: [
      {
        order: 1,
        title: 'Test stage',
        description: 'integration test',
        trigger_type: 'manual',
        trigger_config: {},
      },
    ],
  })
  if (error) throw new Error(`accept_brief failed: ${error.message}`)
  const r = data as { brief: { id: string }; initial_status: string; queue_position: number }
  return { briefId: r.brief.id, initialStatus: r.initial_status, queuePosition: r.queue_position }
}

test.describe('V1.x-B.1.1 scheduler / queue / status API', () => {
  let orgA: string

  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('CK-3: accept_brief queues when active exists; auto-promotes on cancel', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 queue lifecycle')
    try {
      const b1 = await acceptBriefDirect(documentId, 'b1: refine intro')
      expect(b1.initialStatus).toBe('active')
      expect(b1.queuePosition).toBe(0)

      const b2 = await acceptBriefDirect(documentId, 'b2: refine middle')
      expect(b2.initialStatus).toBe('queued')
      expect(b2.queuePosition).toBe(1)

      const b3 = await acceptBriefDirect(documentId, 'b3: refine ending')
      expect(b3.initialStatus).toBe('queued')
      expect(b3.queuePosition).toBe(2)

      // Cancel active b1 → b2 auto-promotes to active.
      const ctx = await ctxA()
      const cancelRes = await ctx.post(`/api/brief/${b1.briefId}/cancel`, {
        data: { reason: 'pivot' },
      })
      expect(cancelRes.status()).toBe(200)
      const cascade = await cancelRes.json()
      expect(cascade.brief_id).toBe(b1.briefId)
      expect(cascade.promoted_brief_id).toBe(b2.briefId)

      // b2 is now active, b3 still queued.
      const { data: state } = await adminClient()
        .from('briefs')
        .select('id, status, sequence_position, cause')
        .eq('document_id', documentId)
        .in('status', ['active', 'queued'])
        .order('sequence_position', { ascending: true })

      expect(state).toHaveLength(2)
      const active = state!.find((b) => b.status === 'active')
      const queued = state!.find((b) => b.status === 'queued')
      expect(active!.id).toBe(b2.briefId)
      expect(active!.cause).toBe('sequence_promotion')
      expect(queued!.id).toBe(b3.briefId)
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('GET /api/scheduler/queue returns brief queue + jobs', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 queue read')
    try {
      const b1 = await acceptBriefDirect(documentId, 'q1: read test')
      await acceptBriefDirect(documentId, 'q2: queued')

      const ctx = await ctxA()
      const res = await ctx.get(`/api/scheduler/queue?document_id=${documentId}`)
      expect(res.status()).toBe(200)
      const body = await res.json()

      expect(body.document_id).toBe(documentId)
      expect(body.brief.active).not.toBeNull()
      expect(body.brief.active.brief_id).toBe(b1.briefId)
      expect(body.brief.queue).toHaveLength(1)
      expect(body.brief.queue[0].sequence_position).toBe(1)
      expect(Array.isArray(body.jobs)).toBe(true)
      expect(body.pagination.limit).toBe(50)
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('GET /api/scheduler/queue rejects missing document_id', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/scheduler/queue')
    expect(res.status()).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_document_id')
  })

  test('POST /api/brief/queue/reorder atomically swaps queued positions', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 reorder')
    try {
      await acceptBriefDirect(documentId, 'r1: active')
      const r2 = await acceptBriefDirect(documentId, 'r2: was pos 1')
      const r3 = await acceptBriefDirect(documentId, 'r3: was pos 2')

      const ctx = await ctxA()
      // Swap the queue order so r3 is first now.
      const res = await ctx.post('/api/brief/queue/reorder', {
        data: {
          document_id: documentId,
          ordered_brief_ids: [r3.briefId, r2.briefId],
        },
      })
      expect(res.status()).toBe(200)

      const { data: queued } = await adminClient()
        .from('briefs')
        .select('id, sequence_position')
        .eq('document_id', documentId)
        .eq('status', 'queued')
        .order('sequence_position', { ascending: true })

      expect(queued).toHaveLength(2)
      expect(queued![0].id).toBe(r3.briefId)
      expect(queued![0].sequence_position).toBe(1)
      expect(queued![1].id).toBe(r2.briefId)
      expect(queued![1].sequence_position).toBe(2)
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('POST /api/brief/queue/reorder rejects mismatched id set', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 reorder mismatch')
    try {
      await acceptBriefDirect(documentId, 'rm1: active')
      const r2 = await acceptBriefDirect(documentId, 'rm2: queued')

      const ctx = await ctxA()
      // Send only one of the two queued ids.
      const res = await ctx.post('/api/brief/queue/reorder', {
        data: {
          document_id: documentId,
          ordered_brief_ids: [r2.briefId],
        },
      })
      // Wait — only r2 is queued in this scenario (rm1 is active). So
      // ordered_brief_ids: [r2.briefId] matches the queued set exactly.
      // Test passes the matching path; reshape to test mismatch:
      expect(res.status()).toBe(200)

      // Now actually mismatch: send a fake UUID.
      const fakeId = '11111111-1111-4111-8111-111111111111'
      const res2 = await ctx.post('/api/brief/queue/reorder', {
        data: {
          document_id: documentId,
          ordered_brief_ids: [r2.briefId, fakeId],
        },
      })
      expect(res2.status()).toBe(409)
      const body = await res2.json()
      expect(body.error).toBe('queue_set_mismatch')
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('POST /api/scheduler/jobs/[id]/cancel sets agent_job to cancelled', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 job cancel')
    try {
      // Insert an agent_job in 'pending' status.
      const { data: job } = await adminClient()
        .from('agent_jobs')
        .insert({
          organisation_id: orgA,
          document_id: documentId,
          operation_type: 'refine',
          status: 'pending',
          triggered_by: 'integration-test',
          route: 'platform',
        })
        .select()
        .single()

      const ctx = await ctxA()
      const res = await ctx.post(`/api/scheduler/jobs/${job!.id}/cancel`, {
        data: { reason: 'test cancel' },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.job_id).toBe(job!.id)
      expect(body.final_status).toBe('cancelled')

      // Verify in DB.
      const { data: after } = await adminClient()
        .from('agent_jobs')
        .select('status, error_message')
        .eq('id', job!.id)
        .single()
      expect(after!.status).toBe('cancelled')
      expect(after!.error_message).toContain('cancelled_by_user')
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('POST /api/scheduler/jobs/[id]/intent updates execution_intent', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 intent')
    try {
      const { data: job } = await adminClient()
        .from('agent_jobs')
        .insert({
          organisation_id: orgA,
          document_id: documentId,
          operation_type: 'refine',
          status: 'pending',
          triggered_by: 'integration-test',
          execution_intent: 'immediate',
          route: 'platform',
        })
        .select()
        .single()

      const ctx = await ctxA()
      const res = await ctx.post(`/api/scheduler/jobs/${job!.id}/intent`, {
        data: { execution_intent: 'parked' },
      })
      expect(res.status()).toBe(200)

      const { data: after } = await adminClient()
        .from('agent_jobs')
        .select('execution_intent')
        .eq('id', job!.id)
        .single()
      expect(after!.execution_intent).toBe('parked')
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('POST /api/scheduler/jobs/[id]/intent rejects batched_24h in B.1.1', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 intent reject')
    try {
      const { data: job } = await adminClient()
        .from('agent_jobs')
        .insert({
          organisation_id: orgA,
          document_id: documentId,
          operation_type: 'refine',
          status: 'pending',
          triggered_by: 'integration-test',
        })
        .select()
        .single()

      const ctx = await ctxA()
      const res = await ctx.post(`/api/scheduler/jobs/${job!.id}/intent`, {
        data: { execution_intent: 'batched_24h' },
      })
      expect(res.status()).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('invalid_intent')
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('POST /api/scheduler/jobs/[id]/reschedule sets scheduled_at', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 reschedule')
    try {
      const { data: job } = await adminClient()
        .from('agent_jobs')
        .insert({
          organisation_id: orgA,
          document_id: documentId,
          operation_type: 'refine',
          status: 'pending',
          triggered_by: 'integration-test',
        })
        .select()
        .single()

      const future = new Date(Date.now() + 60_000).toISOString()
      const ctx = await ctxA()
      const res = await ctx.post(`/api/scheduler/jobs/${job!.id}/reschedule`, {
        data: { scheduled_at: future },
      })
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.scheduled_at).toBe(future)

      // Reschedule with null clears.
      const res2 = await ctx.post(`/api/scheduler/jobs/${job!.id}/reschedule`, {
        data: { scheduled_at: null },
      })
      expect(res2.status()).toBe(200)
      const body2 = await res2.json()
      expect(body2.scheduled_at).toBeNull()
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })

  test('GET /api/status/pending-attention returns counts', async () => {
    const ctx = await ctxA()
    const res = await ctx.get('/api/status/pending-attention')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(typeof body.running_jobs).toBe('number')
    expect(typeof body.queued_briefs).toBe('number')
    expect(typeof body.active_briefs).toBe('number')
    expect(typeof body.failed_jobs).toBe('number')
    expect(typeof body.alerts).toBe('number')
  })

  test('GET /api/status/document/[id]/pending-director returns shape', async () => {
    const { projectId, documentId } = await newDocument(orgA, 'V1.x-B.1.1 pending director')
    try {
      const ctx = await ctxA()
      const res = await ctx.get(`/api/status/document/${documentId}/pending-director`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(typeof body.has_pending).toBe('boolean')
      expect(Array.isArray(body.types)).toBe(true)
    } finally {
      await adminClient().from('projects').delete().eq('id', projectId)
    }
  })
})
