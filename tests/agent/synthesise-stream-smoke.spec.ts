// T-9 — Functional smoke test for POST /api/agent/synthesise/stream.
//
// Source: stelavox_phase5c_build_checklist_v1_0.md §3 T-9.
//         stelavox_phase5c_test_plan_v1_0.md (TC-A class for streaming).
//
// Logs in as j5-walk via the Playwright login flow, then POSTs to the
// streaming endpoint via page.request.post() (cookie-bearing) against an
// unlocked beat in Act 1. Reads the full SSE response body, parses event
// blocks, and asserts:
//
//   - The first event is `agent_job_created` with an agent_job_id.
//   - At least 5 `text_delta` events arrive (CK-1 acceptance threshold).
//   - A `usage` event arrives carrying tokens_input + tokens_output > 0.
//   - An `agent_job_complete` event arrives carrying result_prose.
//   - The final event is `done`.
//   - The `agent_jobs` row ends with status='completed', non-empty
//     result_prose, tokens recorded, cost > 0.
//
// Cost: ~$0.01 per run on Haiku 4.5. Skipped automatically when
// ANTHROPIC_API_KEY is missing or empty.

import { test, expect } from '@playwright/test'
import { execSync } from 'child_process'
import { resolve } from 'path'

import { adminClient } from '../helpers/db'
import { APP_URL } from '../helpers/auth'

const J5_USER = {
  email: 'j5-walk@example.com',
  password: 'Test1234!Test1234!',
}

interface Setup {
  organisationId: string
  documentId: string
  beatNodeId: string
  beatVersion: number
}

let setup: Setup | null = null

const hasLLMKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0

interface ParsedSseEvent {
  event: string
  data: Record<string, unknown>
}

function parseSseStream(body: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = []
  for (const block of body.split('\n\n')) {
    const lines = block.split('\n')
    let event = 'message'
    const dataParts: string[] = []
    for (const line of lines) {
      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim())
    }
    if (dataParts.length === 0) continue
    try {
      const data = JSON.parse(dataParts.join('\n')) as Record<string, unknown>
      events.push({ event, data })
    } catch {
      // ignore parse errors — heartbeat-style comments without data
    }
  }
  return events
}

test.describe('Phase 5c — synthesise streaming smoke (TC-A-1 functional)', () => {
  test.beforeAll(async () => {
    if (!hasLLMKey) {
      test.skip(true, 'ANTHROPIC_API_KEY not set; live LLM test cannot run')
    }

    // Re-seed j5-novel so we have a clean fixture.
    // SKIP_SEED=1 — bypass for cloud smoke runs (Phase 5b T-18.3 pattern):
    // the cloud DB is pre-seeded once; re-seeding it on every smoke run
    // would be wasteful and risk colliding with other tests pointing at
    // the same project.
    if (!process.env.SKIP_SEED) {
      execSync('npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset', {
        cwd: resolve(__dirname, '../..'),
        stdio: 'pipe',
        encoding: 'utf8',
      })
    }

    const admin = adminClient()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const user = (users?.users ?? []).find((u) => u.email === J5_USER.email)
    if (!user) throw new Error('j5-walk user missing')
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', user.id)
      .single()
    if (!member) throw new Error('member missing')
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('organisation_id', member.organisation_id)
      .eq('name', 'j5-novel')
      .single()
    if (!project) throw new Error('project missing')
    const { data: doc } = await admin
      .from('documents')
      .select('id')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (!doc) throw new Error('doc missing')

    // Pick the first unlocked beat in Act 1 (ch-2-sc-1-bt-1 maps to "The
    // bedside drawer" per fixtures/director-corpus/j5-novel/structure.ts).
    const { data: beat } = await admin
      .from('nodes')
      .select('id, version, node_type, name')
      .eq('document_id', doc.id)
      .eq('node_type', 'beat')
      .order('order')
      .limit(1)
      .single()
    if (!beat) throw new Error('no beat in fixture')

    setup = {
      organisationId: member.organisation_id,
      documentId: doc.id,
      beatNodeId: beat.id,
      beatVersion: beat.version,
    }
  })

  test('POST /api/agent/synthesise/stream returns a clean SSE event sequence and persists result_prose', async ({ page }) => {
    test.slow() // Allow up to 90s for the full streaming run.
    if (!setup) throw new Error('setup not initialised')

    // Login (cookie captured into the page context).
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', J5_USER.email)
    await page.fill('input[type="password"]', J5_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    // POST to the streaming endpoint via the cookie-authed request context.
    // page.request.post buffers the entire SSE body before resolving — that
    // is sufficient for a smoke test since we just need to verify the wire
    // shape end-to-end.
    const res = await page.request.post(
      `${APP_URL}/api/agent/synthesise/stream`,
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        data: {
          node_id: setup.beatNodeId,
          agent_instruction:
            "Write the prose for this beat. Stay in Voss's third-person-close voice. Around 200 words.",
        },
        timeout: 90_000,
      },
    )
    expect(res.status(), `HTTP ${res.status()}: ${await res.text()}`).toBe(200)

    const body = await res.text()
    const events = parseSseStream(body)

    // Every recognised event type that should appear at least once.
    const eventNames = events.map((e) => e.event)
    const eventCounts: Record<string, number> = {}
    for (const n of eventNames) eventCounts[n] = (eventCounts[n] ?? 0) + 1

    expect(eventNames[0], 'first event must be agent_job_created').toBe('agent_job_created')
    expect(eventCounts.text_delta ?? 0).toBeGreaterThanOrEqual(5)
    expect(eventCounts.usage ?? 0).toBe(1)
    expect(eventCounts.agent_job_complete ?? 0).toBe(1)
    expect(eventNames[eventNames.length - 1]).toBe('done')

    const jobCreatedEvent = events.find((e) => e.event === 'agent_job_created')!
    const agentJobId = jobCreatedEvent.data.agent_job_id as string
    expect(agentJobId).toMatch(/^[0-9a-f-]{36}$/)

    const usageEvent = events.find((e) => e.event === 'usage')!
    expect(usageEvent.data.tokens_input as number).toBeGreaterThan(0)
    expect(usageEvent.data.tokens_output as number).toBeGreaterThan(0)

    const completeEvent = events.find((e) => e.event === 'agent_job_complete')!
    expect(completeEvent.data.agent_job_id).toBe(agentJobId)
    expect(completeEvent.data.status).toBe('completed')
    expect((completeEvent.data.result_prose as string).length).toBeGreaterThan(50)

    // Verify the agent_jobs row matches the SSE-reported state.
    const admin = adminClient()
    const { data: job } = await admin
      .from('agent_jobs')
      .select('status, result_prose, tokens_input, tokens_output, cost_usd, model_id')
      .eq('id', agentJobId)
      .maybeSingle()
    expect(job?.status).toBe('completed')
    expect((job?.result_prose ?? '').length).toBeGreaterThan(50)
    expect((job?.tokens_input ?? 0) + (job?.tokens_output ?? 0)).toBeGreaterThan(0)
    expect(job?.cost_usd ?? 0).toBeGreaterThan(0)
    expect(job?.model_id).toBeTruthy()
  })
})
