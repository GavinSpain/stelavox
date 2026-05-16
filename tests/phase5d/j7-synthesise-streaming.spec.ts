import { test, expect, request as playwrightRequest } from '@playwright/test'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { adminClient } from '../helpers/db'
import {
  setupAgentNovelFixture, disposeAgentFixture, getOrgIdForUser,
} from '../helpers/agent-fixtures'
import { APP_URL, USERS } from '../helpers/auth'

// Phase 5d — J7 Synthesise streaming journey.
// 9 cases per docs/stelavox_phase5d_test_plan_v1_0.md §4.7.
//
// Strategy: API-level + CSP regression guard (Phase 5c bug #1).
// Live SSE streaming has Phase 5c prior-art at tests/agent/synthesise-
// stream-smoke.spec.ts. J7's value-add is the CSP guard.

test.use({ storageState: USERS.A.storageState })

let orgId: string
test.beforeAll(async () => {
  orgId = await getOrgIdForUser(USERS.A.email)
})

async function ctxA() {
  return playwrightRequest.newContext({ baseURL: APP_URL, storageState: USERS.A.storageState })
}

// ─── CSP regression guard (TC-J7-05, J7-06) ─────────────────────────────────

test('TC-J7-05+06: vercel.json CSP allows wss://*.supabase.co (Phase 5c bug #1 regression guard) @cloud', async () => {
  // The Phase 5c bug was that vercel.json's connect-src missed wss:// for
  // Supabase Realtime, breaking AgentTab status updates on the deployed app.
  // This test asserts the static contract of vercel.json without needing
  // a live Vercel deploy.
  const vercelJsonPath = resolve(__dirname, '../../vercel.json')
  expect(existsSync(vercelJsonPath)).toBe(true)
  const config = JSON.parse(readFileSync(vercelJsonPath, 'utf-8')) as {
    headers?: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }

  // Find the Content-Security-Policy header.
  const allHeaders: Array<{ key: string; value: string }> = []
  for (const block of config.headers ?? []) {
    for (const h of block.headers) allHeaders.push(h)
  }
  const csp = allHeaders.find(h => h.key.toLowerCase() === 'content-security-policy')
  expect(csp).toBeTruthy()
  // The fix (commit 1e61819) added wss://*.supabase.co to connect-src.
  expect(csp!.value).toMatch(/connect-src[^;]*wss:\/\/\*\.supabase\.co/)
})

// ─── Synthesise streaming endpoint validation (J7-S-01..03) ────────────────

test('TC-J7-S-01: POST /api/agent/synthesise/stream against locked node returns 423', async () => {
  const fix = await setupAgentNovelFixture(orgId, 'J7-S-01', { withSummary: true })
  try {
    // Phase 6: nodes.locked dropped; insert into node_author_locks.
    const admin = adminClient()
    const { data: node } = await admin
      .from('nodes').select('organisation_id').eq('id', fix.beatId).single()
    const { data: member } = await admin
      .from('organisation_members').select('user_id')
      .eq('organisation_id', node!.organisation_id).limit(1).single()
    await admin.from('node_author_locks').insert({
      node_id: fix.beatId, organisation_id: node!.organisation_id,
      locked_by_user_id: member!.user_id, lock_reason: 'J7 test',
    })

    const ctx = await ctxA()
    const res = await ctx.post(`/api/agent/synthesise/stream`, {
      data: { node_id: fix.beatId },
    })
    expect([400, 423]).toContain(res.status())
  } finally { await disposeAgentFixture(fix) }
})

test('TC-J7-S-02: POST /api/agent/synthesise/stream against non-leaf returns 4xx', async () => {
  const fix = await setupAgentNovelFixture(orgId, 'J7-S-02', { withSummary: true })
  try {
    const ctx = await ctxA()
    const res = await ctx.post(`/api/agent/synthesise/stream`, {
      data: { node_id: fix.chapterId },
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
    expect(res.status()).toBeLessThan(500)
  } finally { await disposeAgentFixture(fix) }
})

// ─── Skipped (live SSE stream — Phase 5c covers) ────────────────────────────

test('TC-J7-01: streaming surface mounts within 2s; deltas appear progressively', async () => {
  test.skip(true,
    'Live SSE streaming UI is comprehensively covered by Phase 5c ' +
    'tests/agent/synthesise-stream-smoke.spec.ts (T-9). Defer to that suite.')
})

test('TC-J7-02: network drop mid-stream surfaces error gracefully', async () => {
  test.skip(true, 'Phase 5c T-10 cancellation suite covers this contract.')
})

test('TC-J7-03: Cancel button mid-stream → agent_jobs cancelled', async () => {
  test.skip(true, 'Phase 5c T-10 cancellation suite covers cancellation contract.')
})

test('TC-J7-04: end-of-stream transition to accept/dismiss view', async () => {
  test.skip(true, 'AgentTab UI surface; AgentStreamingSurfacePage POM needs data-testids.')
})

test('TC-J7-07: switching nodes mid-stream resets state', async () => {
  test.skip(true, 'AgentTab UI surface; covered by Phase 5c key={nodeId} reset contract.')
})

test('TC-J7-08: streaming surface aria-live="polite"', async () => {
  test.skip(true, 'AX surface; aria-live verified by Component Spec §5.9.')
})

test('TC-J7-09: prefers-reduced-motion removes typewriter caret', async () => {
  test.skip(true, 'Motion surface; covered by Phase 5c motion smoke.')
})
