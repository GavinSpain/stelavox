// j5-novel fixture functional smoke.
//
// Drives the §J5 fixture end-to-end through the user-visible path. Catches
// the class of bugs where the seeder, the API, or the editor disagree on
// content format (e.g. plain text vs Tiptap JSON). Zero LLM cost — does
// not send any Director message.
//
// Owns its own login because the j5-walk user is not in tests/helpers/auth
// USERS (it is owned by the corpus seeder, not the global-setup).
//
// Spec authority: docs/stelavox_director_eval_methodology_v1_0.md §10
// (functional vs quality test layers).

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

// Specific phrases from fixtures/director-corpus/j5-novel/content.ts. If
// these change in content.ts, update them here in the same edit.
const CH1_SUMMARY_PHRASE = 'Voss arrives at the Calder Street halfway house'
const CH1_SC1_BT1_PROSE_PHRASE = 'Voss takes the steps to the Calder Street house in twos'
const BRACKET_SUMMARY_PHRASE = 'Marcus Bracket is a city councillor'

// ─── Helpers ──────────────────────────────────────────────────────────

async function loginAsJ5Walk(page: Page) {
  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', J5_USER.email)
  await page.fill('input[type="password"]', J5_USER.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
}

async function getDocumentIdFromDb(): Promise<{ projectId: string; documentId: string }> {
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
  return { projectId: project.id, documentId: doc.id }
}

// ─── Suite ────────────────────────────────────────────────────────────

test.describe('j5-novel fixture — functional smoke', () => {
  let projectId: string
  let documentId: string

  test.beforeAll(() => {
    // Seed the fixture fresh every suite run. The seed script is idempotent
    // with --reset; it ensures the j5-walk user exists, deletes any prior
    // j5-novel project for that user, and rebuilds tree + content + context.
    execSync('npx tsx scripts/seed-director-fixture.ts --scenario j5-novel --reset', {
      cwd: resolve(__dirname, '../..'),
      stdio: 'pipe',
      encoding: 'utf8',
    })
  })

  test.beforeEach(async () => {
    // Resolve project + document IDs after each beforeAll seed run.
    ;({ projectId, documentId } = await getDocumentIdFromDb())
  })

  test('login + dashboard shows j5-novel project', async ({ page }) => {
    await loginAsJ5Walk(page)
    await expect(page.getByText(PROJECT_NAME).first()).toBeVisible({ timeout: 5000 })
  })

  test('document editor renders chapter summary content', async ({ page }) => {
    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    // The tree should show "Chapter 1: The November Set" — clicking it
    // selects the node and the detail panel renders its summary.
    const chapter1Tree = page.getByRole('treeitem', { name: /Chapter 1: The November Set/ })
    await expect(chapter1Tree).toBeVisible({ timeout: 5000 })
    await chapter1Tree.click()

    // The summary editor should now contain the engineered Ch 1 summary
    // phrase. This is the assertion that catches plain-text-vs-Tiptap
    // mismatches — the editor renders Tiptap-formed content as visible
    // text in the DOM; a malformed summary renders as empty.
    await expect(page.getByText(CH1_SUMMARY_PHRASE)).toBeVisible({ timeout: 5000 })
  })

  test('beat node renders prose content', async ({ page }) => {
    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    // The existing tree_detail_panel test (tests/ui/tree_detail_panel.spec.ts:72)
    // selects rows via getByLabel — the NodeRow inner div has
    // aria-label="${name}, ${status}". Clicking that targets the row's
    // own onClick handler reliably.
    //
    // After the click, react-arborist may not have toggled (depends on
    // where in the row the click landed). Use ArrowRight as a follow-up
    // to ensure expansion — it's idempotent on already-expanded nodes.
    const ch1 = page.getByLabel(/Chapter 1: The November Set, draft/)
    await expect(ch1).toBeVisible({ timeout: 5000 })
    await ch1.click()
    await page.keyboard.press('ArrowRight')

    const sc1 = page.getByLabel(/Scene 1: Calder Street, draft/)
    await expect(sc1).toBeVisible({ timeout: 5000 })
    await sc1.click()
    await page.keyboard.press('ArrowRight')

    const bt1 = page.getByLabel(/Arrival at the halfway house, draft/)
    await expect(bt1).toBeVisible({ timeout: 5000 })
    await bt1.click() // beat is a leaf — click selects

    // Beat opens — the ProseEditor should render the engineered prose.
    // 10s timeout to allow for the node-fetch + Tiptap mount.
    await expect(page.getByText(CH1_SC1_BT1_PROSE_PHRASE)).toBeVisible({ timeout: 10_000 })
  })

  test('Chapter 1 has a lock indicator', async ({ page }) => {
    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    // The tree loads with Act 1 expanded; Chapter 1 is visible by default.
    // Do not click Act 1 — that would collapse it.

    // NodeRow renders a 🔒 emoji glyph for locked nodes (NodeRow.tsx
    // line 156 — `{locked ? '🔒' : '·'}`). The glyph lives in an
    // aria-hidden span so we cannot use ARIA — match on visible text
    // within the row.
    const ch1Row = page.getByRole('treeitem', { name: /Chapter 1: The November Set/ })
    await expect(ch1Row).toBeVisible({ timeout: 5000 })
    await expect(ch1Row).toContainText('🔒')

    // Sanity-negative: an unlocked sibling (Chapter 2) should NOT carry
    // the glyph. This catches the case where the seeder accidentally
    // locked everything.
    const ch2Row = page.getByRole('treeitem', { name: /Chapter 2: Cold Mailbox/ })
    await expect(ch2Row).toBeVisible()
    await expect(ch2Row).not.toContainText('🔒')
  })

  test('Bracket context node renders its summary', async ({ page }) => {
    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    // Context nodes are not in the structural NodeTree — they live in
    // the Sidebar's Context library, grouped by type. The Characters
    // section has data-testid="sidebar-section-character" per
    // SidebarContextSection.tsx. Sections may be collapsed by default
    // (state persists in localStorage). If the Bracket row is not
    // already visible, expand the section header.
    const charSection = page.locator('[data-testid="sidebar-section-character"]')
    await expect(charSection).toBeVisible({ timeout: 5000 })

    const bracket = charSection.getByText('Councillor Marcus Bracket')
    if (!(await bracket.isVisible().catch(() => false))) {
      // Expand the Characters section by clicking the header.
      await charSection.getByRole('button').first().click()
    }
    await expect(bracket).toBeVisible({ timeout: 5000 })
    await bracket.click()

    await expect(page.getByText(BRACKET_SUMMARY_PHRASE)).toBeVisible({ timeout: 5000 })
  })

  test('Director Mode mounts the DirectorPanel', async ({ page }) => {
    await loginAsJ5Walk(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    // Switch to Director Mode via the ModeTabBar.
    await page.getByRole('tab', { name: 'Director' }).click()

    const panel = page.getByRole('complementary', { name: 'Director' })
    await expect(panel).toBeVisible({ timeout: 5000 })
    // The header should mention the Director.
    await expect(panel.locator('h2')).toContainText(/Director/i, { timeout: 3000 })
    // The DirectorInput should be present.
    await expect(panel.getByRole('textbox')).toBeVisible({ timeout: 3000 })
  })
})
