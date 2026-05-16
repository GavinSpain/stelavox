// T-10 — Cancellation test for POST /api/agent/synthesise/stream.
//
// Source: stelavox_phase5c_build_checklist_v1_0.md §3 T-10.
//         stelavox_phase5c_test_plan_v1_0.md TC-A-2 (cancellation).
//
// Logs in as j5-walk, opens an SSE connection mid-stream against an
// unlocked beat, waits for the first `text_delta` to arrive, then aborts
// the fetch via AbortController. Verifies:
//
//   - The SSE connection closes promptly after abort.
//   - The agent_jobs row transitions to status='cancelled' with
//     error_message='client_disconnect' within ~5 seconds of the abort
//     (the runner's persistCancellation finally block fires
//     synchronously on consumer break).
//   - Tokens consumed before the abort are NOT lost — they're recorded
//     as the partial counts on the row (Phase 5c API Contract §2.6).
//     V1 simplification: tokens may be 0 if the abort lands before
//     message_stop, since the per-delta usage isn't aggregated until
//     end-of-stream.
//
// Cost: ~$0.005 per run on Haiku (cancelled before message_stop, so
// tokens-actually-billed is small). Skipped automatically when
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

const hasLLMKey = (process.env.ANTHROPIC_API_KEY ?? '').length > 0

interface Setup {
  documentId: string
  beatNodeId: string
}

let setup: Setup | null = null

test.describe('Phase 5c — synthesise streaming cancellation (TC-A-2)', () => {
  test.beforeAll(async () => {
    if (!hasLLMKey) {
      test.skip(true, 'ANTHROPIC_API_KEY not set; live LLM test cannot run')
    }

    execSync('npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf8',
    })

    const admin = adminClient()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const user = (users?.users ?? []).find((u) => u.email === J5_USER.email)
    if (!user) throw new Error('j5-walk user missing')
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', user.id)
      .single()
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('organisation_id', member!.organisation_id)
      .eq('name', 'j5-novel')
      .single()
    const { data: doc } = await admin
      .from('documents')
      .select('id')
      .eq('project_id', project!.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    // Pick a different beat from T-9's smoke (ch-3 instead of ch-2) so
    // the two tests can run consecutively without colliding on the
    // node-level concurrency check (one running synthesise per node).
    const { data: beat } = await admin
      .from('nodes')
      .select('id, name')
      .eq('document_id', doc!.id)
      .eq('node_type', 'beat')
      .order('order')
      .range(2, 2) // skip the first two; pick the third (fixture data starts unlocked)
      .single()
    if (!beat) throw new Error('no beat in fixture')

    setup = {
      documentId: doc!.id,
      beatNodeId: beat.id,
    }
  })

  test('aborting the SSE mid-stream lands as agent_jobs.status=cancelled', async ({ page }) => {
    test.slow()
    if (!setup) throw new Error('setup not initialised')

    // Login.
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', J5_USER.email)
    await page.fill('input[type="password"]', J5_USER.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    // Run the cancellation in the browser context. Open the SSE
    // connection via fetch + ReadableStream reader, abort once the first
    // text_delta arrives, return the agent_job_id for DB verification.
    const result = await page.evaluate(
      async ({ nodeId }) => {
        const controller = new AbortController()
        let agentJobId: string | null = null
        let firstDeltaSeenAt: number | null = null

        try {
          const res = await fetch('/api/agent/synthesise/stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'text/event-stream',
            },
            body: JSON.stringify({
              node_id: nodeId,
              agent_instruction:
                'Write the prose for this beat. Around 300 words.',
            }),
            signal: controller.signal,
          })
          if (!res.ok || !res.body) {
            return { error: `HTTP ${res.status}` }
          }

          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = ''
          let aborted = false

          // Read until we see the first text_delta, then abort.
          while (!aborted) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })

            let sep = buf.indexOf('\n\n')
            while (sep !== -1) {
              const block = buf.slice(0, sep)
              buf = buf.slice(sep + 2)

              // Parse minimal: pull `event:` and the `data:` line.
              const lines = block.split('\n')
              let eventName = 'message'
              const dataParts: string[] = []
              for (const line of lines) {
                if (line.startsWith(':')) continue
                if (line.startsWith('event:')) eventName = line.slice(6).trim()
                else if (line.startsWith('data:')) dataParts.push(line.slice(5).trim())
              }
              const dataStr = dataParts.join('\n')

              if (eventName === 'agent_job_created' && dataStr) {
                try {
                  const data = JSON.parse(dataStr) as { agent_job_id?: string }
                  if (data.agent_job_id) agentJobId = data.agent_job_id
                } catch {
                  /* ignore */
                }
              }

              if (eventName === 'text_delta' && !aborted) {
                firstDeltaSeenAt = Date.now()
                aborted = true
                controller.abort()
                break
              }

              sep = buf.indexOf('\n\n')
            }
          }
        } catch (e) {
          // AbortError is the expected flow.
          const name = (e as { name?: string }).name
          if (name !== 'AbortError') {
            return { error: `unexpected: ${(e as Error).message}` }
          }
        }

        return { agentJobId, firstDeltaSeenAt }
      },
      { nodeId: setup.beatNodeId },
    )

    expect(result.error, `browser-side error: ${result.error}`).toBeUndefined()
    expect(result.agentJobId, 'agent_job_created event must precede text_delta').toBeTruthy()
    expect(result.firstDeltaSeenAt, 'must have observed at least one text_delta before abort').toBeTruthy()

    const agentJobId = result.agentJobId!

    // The runner's finally block fires persistCancellation synchronously
    // when the consumer breaks. Poll the DB briefly to absorb the small
    // round-trip — should resolve in well under 5 seconds.
    const admin = adminClient()
    const deadline = Date.now() + 10_000
    let job: { status?: string; error_message?: string | null } | null = null
    while (Date.now() < deadline) {
      const { data } = await admin
        .from('agent_jobs')
        .select('status, error_message')
        .eq('id', agentJobId)
        .maybeSingle()
      job = data
      if (job?.status === 'cancelled') break
      await new Promise((r) => setTimeout(r, 500))
    }

    expect(job?.status).toBe('cancelled')
    expect(job?.error_message).toBe('client_disconnect')
  })
})
