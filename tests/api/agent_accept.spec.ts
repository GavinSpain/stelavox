// Phase 5 agent Accept transactional tests.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §5
//       TC-A-21, A-22, A-25, A-26
//       Migration 029 accept_agent_job RPC
//
// Uses pre-seeded `completed`-state agent_jobs rows so the tests
// don't need a real LLM call. The Accept route is the
// integration boundary under test, not the Edge Function.

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

test.describe('Phase 5 — TC-A Accept transactional', () => {
  let orgId: string
  let userAId: string

  test.beforeAll(async () => {
    orgId = await getOrgIdForUser(USERS.A.email)
    userAId = await getUserId(USERS.A.email)
  })

  test('TC-A-21 — Accept commits expand result + writes node_versions row', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-21', { withSummary: true })
    try {
      const profileId = await getProfileId('expand_chapter_into_scenes')
      // Seed completed expand job with 2 child node proposals
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.chapterId,
        operationType: 'expand', profileId, triggeredBy: userAId,
        targetVersion: 1,
        resultColumns: {
          result_child_nodes: [
            { name: 'New Scene 1', short_description: 'Foo', summary: 'Plain summary 1', position: 0 },
            { name: 'New Scene 2', short_description: 'Bar', summary: 'Plain summary 2', position: 1 },
          ],
        },
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect(res.status()).toBe(200)
      const body = await res.json()
      expect(body.agent_job.status).toBe('accepted')
      expect(body.applied.child_nodes_created).toHaveLength(2)

      // Verify scene rows exist under chapter (chapter already has S1; new ones land at end)
      const { data: kids } = await adminClient()
        .from('nodes').select('name, "order"')
        .eq('parent_id', fix.chapterId).order('order')
      const names = (kids ?? []).map(k => k.name)
      expect(names).toContain('New Scene 1')
      expect(names).toContain('New Scene 2')

      // Verify a node_versions row was written for the chapter (capturing pre-accept state)
      const { count: versionCount } = await adminClient()
        .from('node_versions').select('*', { count: 'exact', head: true })
        .eq('node_id', fix.chapterId)
      expect((versionCount ?? 0)).toBeGreaterThanOrEqual(1)
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-22 — Accept synthesise produces well-formed Tiptap JSON', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-22', { withSummary: true })
    try {
      const profileId = await getProfileId('synthesise_beat')
      const proseText = 'First paragraph of beat prose.\n\nSecond paragraph follows.'
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.beatId,
        operationType: 'synthesise', profileId, triggeredBy: userAId,
        targetVersion: 1,
        resultColumns: { result_prose: proseText },
      })

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect(res.status()).toBe(200)

      // B4.5: nodes.prose is now JSONB — supabase-js returns the parsed
      // object directly (no JSON.parse needed).
      const { data: beat } = await adminClient()
        .from('nodes').select('prose').eq('id', fix.beatId).single()
      expect(beat?.prose).toBeTruthy()
      const parsed = beat!.prose as unknown as {
        type: string; content: { type: string; content?: { type: string; text?: string }[] }[]
      }
      expect(parsed.type).toBe('doc')
      expect(parsed.content.length).toBeGreaterThanOrEqual(2)  // two paragraphs
      expect(parsed.content[0].type).toBe('paragraph')
      expect(parsed.content[0].content?.[0].text).toContain('First paragraph')
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-25 — Accept rejects target_version_mismatch', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-25', { withSummary: true })
    try {
      const profileId = await getProfileId('refine_beat_summary')
      // Seed job captured at version 1
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.beatId,
        operationType: 'refine', profileId, triggeredBy: userAId,
        targetVersion: 1,
        resultColumns: { result_summary: 'A refined summary.' },
      })

      // Simulate an unrelated PATCH that bumps the beat's version. The
      // Migration 023 trigger only bumps version when summary/prose/notes/
      // metadata changes — direct `version` updates are reverted. Touching
      // notes is a content-field change so the trigger fires once.
      await adminClient().from('nodes')
        .update({ notes: '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Author edit during agent run"}]}]}' })
        .eq('id', fix.beatId)

      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect(res.status()).toBe(409)
      const body = await res.json()
      expect(body.error).toBe('target_version_mismatch')
      expect(body.current_version).toBe(2)
      expect(body.captured_version).toBe(1)

      // Job remains 'completed' (not advanced to 'accepted')
      const { data: job } = await adminClient()
        .from('agent_jobs').select('status').eq('id', jobId).single()
      expect(job?.status).toBe('completed')
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-26 — Accept idempotent on already-accepted', async () => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-26', { withSummary: true })
    try {
      const profileId = await getProfileId('refine_beat_summary')
      const jobId = await seedCompletedJob({
        orgId, documentId: fix.documentId, nodeId: fix.beatId,
        operationType: 'refine', profileId, triggeredBy: userAId,
        targetVersion: 1,
        resultColumns: { result_summary: 'First accept summary.' },
      })

      const ctx = await ctxA()
      const first = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect(first.status()).toBe(200)

      // Snapshot version_count after first accept
      const { count: countAfter1 } = await adminClient()
        .from('node_versions').select('*', { count: 'exact', head: true })
        .eq('node_id', fix.beatId)

      // Second accept should be idempotent — no new versions, no error
      const second = await ctx.post(`${BASE}/api/agent-jobs/${jobId}/accept`)
      expect(second.status()).toBe(200)
      const body = await second.json()
      expect(body.agent_job.status).toBe('accepted')

      const { count: countAfter2 } = await adminClient()
        .from('node_versions').select('*', { count: 'exact', head: true })
        .eq('node_id', fix.beatId)
      expect(countAfter2).toBe(countAfter1)
    } finally { await disposeAgentFixture(fix) }
  })
})
