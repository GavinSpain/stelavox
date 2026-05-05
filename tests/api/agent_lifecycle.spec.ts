// Phase 5 agent-job lifecycle tests (Cancel/Dismiss).
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §5
//       TC-A-28 (cancel running), TC-A-30 (cancel completed → 409)

import { test, expect, request } from '@playwright/test'
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

test.describe('Phase 5 — TC-A agent-job lifecycle', () => {
  let orgId: string
  let userAId: string

  test.beforeAll(async () => {
    orgId = await getOrgIdForUser(USERS.A.email)
    userAId = await getUserId(USERS.A.email)
  })

  test('TC-A-28 — Cancel during running aborts cleanly', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-28', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.chapterId,
        operationType: 'expand', profileId, triggeredBy: userAId,
        status: 'running',
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/cancel`)
      expect(res.status()).toBe(200)

      const { data: job } = await adminClient()
        .from('agent_jobs').select('status, completed_at').eq('id', jobId).single()
      expect(job?.status).toBe('cancelled')
      expect(job?.completed_at).toBeTruthy()
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-30 — Cancel returns 409 on completed job', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-30', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.chapterId,
        operationType: 'expand', profileId, triggeredBy: userAId,
        status: 'completed',
        resultColumns: {
          result_child_nodes: [
            { name: 'Scene', short_description: 'x', summary: 'y', position: 0 },
          ],
        },
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/cancel`)
      expect(res.status()).toBe(409)
      const body = await res.json()
      expect(body.error).toBe('agent_job_not_in_progress')
    } finally { await disposeAgentFixture(fix) }
  })
})
