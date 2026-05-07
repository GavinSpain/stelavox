// j5-novel — Director-turn smoke.
//
// Builds on the functional smoke (j5-fixture-smoke.spec.ts) by sending a
// deliberately tiny probe to the Director and verifying that the wire
// shape works end-to-end: SSE arrives, the assistant message persists,
// no errors. Does NOT score plan quality — that is T-17.1 / T-17.2 work.
//
// Cost: ~$0.005 per run on Haiku 4.5 (override applied via PB-7a). Run
// on demand — not part of the default CI run.
//
// Spec authority: docs/stelavox_director_eval_methodology_v1_0.md §5
// (Pre-merge of any Director-related change — this is the wire-shape
// gate that runs alongside the functional smoke).

import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'child_process'
import { resolve } from 'path'
import { adminClient } from '../helpers/db'
import { APP_URL } from '../helpers/auth'

const J5_USER = {
  email: 'j5-walk@example.com',
  password: 'Test1234!Test1234!',
}

const PROJECT_NAME = 'j5-novel'
const DOCUMENT_NAME = 'The November Set'

const TINY_PROBE = 'In one short sentence: what is this document about?'

async function loginAsJ5Walk(page: Page) {
  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', J5_USER.email)
  await page.fill('input[type="password"]', J5_USER.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
}

async function getDocumentIdFromDb(): Promise<{ projectId: string; documentId: string; orgId: string }> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const j5User = (users?.users ?? []).find((u) => u.email === J5_USER.email)
  if (!j5User) throw new Error('j5-walk user not found in DB after seeding')
  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', j5User.id)
    .single()
  if (!member) throw new Error('j5-walk has no organisation membership')
  const { data: project } = await admin
    .from('projects')
    .select('id')
    .eq('organisation_id', member.organisation_id)
    .eq('name', PROJECT_NAME)
    .single()
  if (!project) throw new Error(`project "${PROJECT_NAME}" not found after seed`)
  const { data: doc } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .eq('name', DOCUMENT_NAME)
    .single()
  if (!doc) throw new Error(`document "${DOCUMENT_NAME}" not found after seed`)
  return { projectId: project.id, documentId: doc.id, orgId: member.organisation_id }
}

test.describe('j5-novel — Director-turn wire-shape smoke', () => {
  let projectId: string
  let documentId: string

  test.beforeAll(() => {
    // Reuse the seeder. If the functional smoke ran in the same suite,
    // this is redundant but cheap. If running this spec in isolation it
    // ensures fresh state.
    execSync('npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf8',
    })
  })

  test.beforeEach(async () => {
    ;({ projectId, documentId } = await getDocumentIdFromDb())
  })

  test('Director responds to a tiny probe end-to-end', async ({ page }) => {
    test.slow() // Streaming can take 10–30s on Haiku.

    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: 'Director' }).click()
    const panel = page.getByRole('complementary', { name: 'Director' })
    await expect(panel).toBeVisible({ timeout: 5000 })

    // Type the probe and send.
    const input = panel.getByRole('textbox')
    await input.fill(TINY_PROBE)
    await input.press('Enter')

    // The user message should appear immediately in the conversation
    // thread.
    await expect(panel.getByText(TINY_PROBE)).toBeVisible({ timeout: 3000 })

    // Wait for the assistant turn to complete. We poll the DB for the
    // assistant message in this conversation. Polling DB is more reliable
    // than parsing SSE in a Playwright test.
    const admin = adminClient()
    const deadline = Date.now() + 90_000 // 90s budget for the streaming turn
    let assistantContent: string | null = null
    while (Date.now() < deadline) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('document_id', documentId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (conv) {
        const { data: msgs } = await admin
          .from('conversation_messages')
          .select('role, content, turn_state')
          .eq('conversation_id', conv.id)
          .eq('role', 'assistant')
          .eq('turn_state', 'final')
          .order('sequence', { ascending: false })
          .limit(1)
        if (msgs && msgs.length > 0 && typeof msgs[0].content === 'string' && msgs[0].content.length > 0) {
          assistantContent = msgs[0].content
          break
        }
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    expect(assistantContent, 'assistant message did not persist within 90s — SSE wire shape may be broken').not.toBeNull()
    expect(assistantContent!.length).toBeGreaterThan(0)

    // No agent_jobs rows should have been created during this turn —
    // the Director's read tools are read-only and the probe asks no
    // question requiring a write tool.
    const { data: jobs } = await admin
      .from('agent_jobs')
      .select('id')
      .gt('created_at', new Date(Date.now() - 120_000).toISOString())
    expect(jobs?.length ?? 0).toBe(0)

    // No workflow rows should exist either (the probe doesn't trigger a
    // plan).
    const { data: workflows } = await admin
      .from('workflows')
      .select('id')
      .eq('document_id', documentId)
    // We don't assert zero here because a future turn might propose a
    // tiny plan even from a "what is this document" probe — Haiku is
    // not fully deterministic. But we can assert the count is small.
    expect((workflows?.length ?? 0)).toBeLessThanOrEqual(1)
  })
})
