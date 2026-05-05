// Phase 5 LLM-bearing agent operation tests.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §1.5 (no LLM mocking),
//       §10.3 (cloud-smoke set: TC-A-04, TC-A-12, TC-A-19, TC-A-25)
//       TC-A-04, A-09, A-12, A-17, A-19
//
// These tests trigger the real Anthropic API. They are slow (~10-30s
// per test) and skipped if ANTHROPIC_API_KEY is not set.
//
// During T-16.1 they run on the platform_config-overridden Haiku model.
// During T-16.2 cloud smoke they run on production-default models
// (Sonnet for expand/refine/generate-context, Opus for synthesise).

import { test, expect, request } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import {
  setupAgentNovelFixture,
  disposeAgentFixture,
  getOrgIdForUser,
} from '../helpers/agent-fixtures'

const BASE = 'http://localhost:3000'

async function ctxA() {
  return request.newContext({ baseURL: BASE, storageState: USERS.A.storageState })
}

const HAS_KEY = !!process.env.ANTHROPIC_API_KEY
const POLL_TIMEOUT_MS = 60_000
const POLL_INTERVAL_MS = 1_500

async function waitForJob(jobId: string, statuses: string[]): Promise<{ status: string; result_child_nodes: unknown; result_summary: string | null; result_prose: string | null; result_metadata: unknown; tokens_input: number | null; tokens_output: number | null; cost_usd: number | null; error_message: string | null }> {
  const start = Date.now()
  while (Date.now() - start < POLL_TIMEOUT_MS) {
    const { data } = await adminClient()
      .from('agent_jobs')
      .select('status, result_child_nodes, result_summary, result_prose, result_metadata, tokens_input, tokens_output, cost_usd, error_message')
      .eq('id', jobId).single()
    if (data && statuses.includes(data.status)) return data
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
  }
  throw new Error(`job ${jobId} did not reach ${statuses.join('|')} within ${POLL_TIMEOUT_MS}ms`)
}

test.describe('Phase 5 — TC-A LLM-bearing happy paths', () => {
  let orgId: string

  test.beforeAll(async () => { orgId = await getOrgIdForUser(USERS.A.email) })

  test.skip(!HAS_KEY, 'no ANTHROPIC_API_KEY set')

  test('TC-A-04 — POST /api/agent/expand end-to-end (cloud-smoke)', async () => {
    test.setTimeout(POLL_TIMEOUT_MS + 30_000)
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-04', { withSummary: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/expand`, {
        data: { node_id: fix.chapterId, target_layer_count: 3 },
      })
      expect(res.status()).toBe(202)
      const { jobId } = await res.json()
      const final = await waitForJob(jobId, ['completed', 'failed'])
      expect(final.status).toBe('completed')
      expect(Array.isArray(final.result_child_nodes)).toBe(true)
      const proposals = final.result_child_nodes as Array<{ name?: string; short_description: string; summary: string; position: number }>
      expect(proposals.length).toBeGreaterThanOrEqual(2)
      for (const p of proposals) {
        expect(typeof p.short_description).toBe('string')
        expect(typeof p.summary).toBe('string')
        expect(typeof p.position).toBe('number')
      }
      expect(final.tokens_input).toBeGreaterThan(0)
      expect(final.cost_usd).toBeGreaterThan(0)
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-09 — POST /api/agent/synthesise happy path on a beat', async () => {
    test.setTimeout(POLL_TIMEOUT_MS + 30_000)
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-09', { withSummary: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/synthesise`, {
        data: { node_id: fix.beatId, prose_target_words: 120 },
      })
      expect(res.status()).toBe(202)
      const { jobId } = await res.json()
      const final = await waitForJob(jobId, ['completed', 'failed'])
      expect(final.status).toBe('completed')
      expect(typeof final.result_prose).toBe('string')
      expect((final.result_prose ?? '').length).toBeGreaterThan(50)
      expect(final.cost_usd).toBeGreaterThan(0)
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-12 — POST /api/agent/refine on prose end-to-end (cloud-smoke)', async () => {
    test.setTimeout(POLL_TIMEOUT_MS + 30_000)
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-12', { withSummary: true, withProse: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/refine`, {
        data: {
          node_id: fix.beatId,
          target_field: 'prose',
          refinement_instruction: 'Tighten the prose; remove any redundancy.',
        },
      })
      expect(res.status()).toBe(202)
      const { jobId } = await res.json()
      const final = await waitForJob(jobId, ['completed', 'failed'])
      expect(final.status).toBe('completed')
      expect(typeof final.result_prose).toBe('string')
      // Ensure the original prose remains unchanged on the node until Accept
      const { data: beat } = await adminClient().from('nodes').select('prose').eq('id', fix.beatId).single()
      expect(beat?.prose).toContain('She paused, her hand on the door')
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-17 — POST /api/agent/generate-context happy path on Character', async () => {
    test.setTimeout(POLL_TIMEOUT_MS + 30_000)
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-17', { withSummary: true, withCharacterEmpty: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/generate-context`, {
        data: { node_id: fix.characterContextId },
      })
      expect(res.status()).toBe(202)
      const { jobId } = await res.json()
      const final = await waitForJob(jobId, ['completed', 'failed'])
      expect(final.status).toBe('completed')
      expect(typeof final.result_summary).toBe('string')
      expect((final.result_summary ?? '').length).toBeGreaterThan(50)
      expect(typeof final.result_metadata).toBe('object')
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-A-19 — POST /api/agent/generate-context on Character (cloud-smoke V1 type)', async () => {
    // The full Test Plan §5 TC-A-19 covers all 6 V1 context types. For the
    // β-scope we exercise Character as the representative case (already
    // exercised in detail by T-15 prompt review across all 6 types).
    test.setTimeout(POLL_TIMEOUT_MS + 30_000)
    const fix = await setupAgentNovelFixture(orgId, 'TC-A-19', { withSummary: true, withCharacterEmpty: true })
    try {
      const ctx = await ctxA()
      const res = await ctx.post(`${BASE}/api/agent/generate-context`, {
        data: { node_id: fix.characterContextId },
      })
      expect(res.status()).toBe(202)
      const { jobId } = await res.json()
      const final = await waitForJob(jobId, ['completed', 'failed'])
      expect(final.status).toBe('completed')
      expect((final.result_summary ?? '').length).toBeGreaterThan(50)
    } finally { await disposeAgentFixture(fix) }
  })
})
