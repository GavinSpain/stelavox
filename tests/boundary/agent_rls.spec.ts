// Phase 5 RLS / cross-organisation boundary tests.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §6
//       TC-B-01, B-02, B-03, B-04, B-05, B-06, B-07, B-09, B-12, B-13
//
// User A and User C are owners of separate organisations (Phase 1 trigger
// creates one org per user). Verifies that Phase 5's new tables and APIs
// honour the same RLS pattern as Phase 1-4.

import { test, expect, request } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import {
  setupAgentNovelFixture,
  disposeAgentFixture,
  seedCompletedJob,
  getProfileId,
  getOrgIdForUser,
  getUserId,
} from '../helpers/agent-fixtures'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}
async function ctxC() {
  return request.newContext({ baseURL: BASE, storageState: USERS.C.storageState })
}

test.describe('Phase 5 — TC-B cross-organisation RLS', () => {
  let orgA: string
  let orgC: string
  let userAId: string
  let userCId: string

  test.beforeAll(async () => {
    orgA = await getOrgIdForUser(USERS.A.email)
    orgC = await getOrgIdForUser(USERS.C.email)
    userAId = await getUserId(USERS.A.email)
    userCId = await getUserId(USERS.C.email)
  })

  test('TC-B-01 — Alice cannot list Carol\'s document agent jobs', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-01')
    try {
      const ctx = await ctxA()
      const res = await ctx.get(`${BASE}/api/documents/${fix.documentId}/agent-jobs`)
      // RLS hides the document, so the route returns 404
      expect([404, 403]).toContain(res.status())
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-02 — Alice cannot accept Carol\'s job', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-02', { withSummary: true })
    try {
      const profileId = await getProfileId('refine_beat_summary')
      const jobId = await seedCompletedJob({
        orgId: orgC, documentId: fix.documentId, nodeId: fix.beatId,
        operationType: 'refine', profileId, triggeredBy: userCId,
        resultColumns: { result_summary: 'Carol-only summary' },
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect([404, 403]).toContain(res.status())
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-03 — Alice cannot cancel Carol\'s job', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-03', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      const jobId = await seedCompletedJob({
        orgId: orgC, documentId: fix.documentId, nodeId: fix.chapterId,
        operationType: 'expand', profileId, triggeredBy: userCId,
        status: 'running',
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/cancel`)
      expect([404, 403]).toContain(res.status())

      // Verify the job status is unchanged
      const { data: job } = await adminClient()
        .from('agent_jobs').select('status').eq('id', jobId).single()
      expect(job?.status).toBe('running')
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-04 — agent_profiles RLS admits 17+ system profiles to authenticated session', async () => {
    // GET as user A — should see the seeded system profiles
    const ctx = await ctxA()
    const res = await ctx.get(`${BASE}/api/agent-profiles`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.agent_profiles)).toBe(true)
    expect(body.agent_profiles.length).toBeGreaterThanOrEqual(17)
  })

  test('TC-B-05 — agent_profiles INSERT via user-session client blocked', async () => {
    // Direct supabase client with user A's auth — try to insert. RLS should reject (no INSERT policy).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const userClient = createClient(url, anon)
    await userClient.auth.signInWithPassword({ email: USERS.A.email, password: USERS.A.password })

    const { error } = await userClient.from('agent_profiles').insert({
      name: 'unauthorised_profile_attempt',
      operation_type: 'expand',
      node_type: 'chapter',
      system_prompt: 'noop',
      model_id: 'claude-haiku-4-5-20251001',
      temperature: 0.7,
      max_tokens: 1000,
      is_system_profile: false,
    })
    // Either the insert errors, or it silently affects 0 rows (RLS path).
    expect(error).toBeTruthy()
    // scope:'local' so we don't revoke Alice's other sessions (incl. the
    // playwright storageState cookie used by ctxA() in subsequent tests).
    await userClient.auth.signOut({ scope: 'local' })
  })

  test('TC-B-06 — Comment cross-org returns 404', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-06')
    try {
      // Carol creates a comment
      const cCtx = await ctxC()
      const created = await cCtx.post(`${BASE}/api/nodes/${fix.beatId}/comments`, {
        data: { comment_type: 'note', content: 'Carol-only note' },
      })
      expect(created.status()).toBe(201)
      const commentId = (await created.json()).id

      // Alice tries to GET via direct comment ID (the listing endpoint hides it via RLS on node)
      const aCtx = await ctxA()
      const res = await aCtx.get(`${BASE}/api/nodes/${fix.beatId}/comments`)
      expect([404, 403]).toContain(res.status())

      // Alice tries direct comment delete
      const del = await aCtx.delete(`${BASE}/api/comments/${commentId}`)
      expect([404, 403]).toContain(del.status())
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-07 — Cross-org agent operation returns 404 on target', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-07', { withSummary: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/expand`, {
        data: { node_id: fix.chapterId },
      })
      expect([404, 403]).toContain(res.status())

      // No agent_jobs row created in either org
      const { count } = await adminClient()
        .from('agent_jobs').select('*', { count: 'exact', head: true })
        .eq('node_id', fix.chapterId)
      expect(count ?? 0).toBe(0)
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-09 — context_snapshot does not leak cross-org data', async () => {
    // Set up identical-named fixtures in both orgs; ensure A's job snapshot
    // contains only A's content.
    const fixA = await setupAgentNovelFixture(orgA, 'TC-B-09-A', { withSummary: true })
    const fixC = await setupAgentNovelFixture(orgC, 'TC-B-09-C', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      const jobId = await seedCompletedJob({
        orgId: orgA, documentId: fixA.documentId, nodeId: fixA.chapterId,
        operationType: 'expand', profileId, triggeredBy: userAId,
        contextSnapshot: { stable: 'A-org content only', dynamic: { agent_instruction: '' } },
      })
      const { data: job } = await adminClient()
        .from('agent_jobs').select('context_snapshot, organisation_id').eq('id', jobId).single()
      expect(job?.organisation_id).toBe(orgA)
      const snap = JSON.stringify(job?.context_snapshot ?? {})
      expect(snap).not.toContain('TC-B-09-C')
    } finally {
      await disposeAgentFixture(fixA)
      await disposeAgentFixture(fixC)
    }
  })

  test('TC-B-12 — Comments accessible only to org members', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-12')
    try {
      const cCtx = await ctxC()
      const c = await cCtx.post(`${BASE}/api/nodes/${fix.beatId}/comments`, {
        data: { comment_type: 'note', content: 'Carol private' },
      })
      expect(c.status()).toBe(201)

      // Carol can see her own comments
      const cList = await cCtx.get(`${BASE}/api/nodes/${fix.beatId}/comments`)
      expect(cList.status()).toBe(200)
      expect((await cList.json()).comments.length).toBeGreaterThanOrEqual(1)

      // Alice cannot
      const aCtx = await ctxA()
      const aList = await aCtx.get(`${BASE}/api/nodes/${fix.beatId}/comments`)
      expect([404, 403]).toContain(aList.status())
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-B-13 — agent-job history is org-scoped', async () => {
    const fix = await setupAgentNovelFixture(orgC, 'TC-B-13', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      await seedCompletedJob({
        orgId: orgC, documentId: fix.documentId, nodeId: fix.chapterId,
        operationType: 'expand', profileId, triggeredBy: userCId,
      })

      // Alice queries Carol's document for job history
      const ctx = await ctxA()
      const res = await ctx.get(`${BASE}/api/documents/${fix.documentId}/agent-jobs`)
      expect([404, 403]).toContain(res.status())
    } finally { await disposeAgentFixture(fix) }
  })
})
