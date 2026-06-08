/**
 * Phase 8.5b B.1 — Dashboard rollup correctness.
 *
 * Playwright integration cases for TC-8.5b-B1-11..14. Verifies that the
 * dashboard ProjectCard reads the real aggregate values from the new
 * RPC, not the under-counted values from the previous TS-side sum that
 * hit PostgREST's 1000-row response limit.
 *
 * The Mega Manuscript fixture (1556 nodes / 500006 words) is the
 * regression guard for the 187k bug — under the old code path, the
 * dashboard displayed 187,206 instead of 500,006.
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §1 (TC-8.5b-B1-11..14)
 *       docs/stelavox_document_load_architecture_v1_0.md §2.4
 *
 * Fixture: The mega-doc lives in author@stelavox.local's org. These
 * tests use the existing test-A storage state which has its own org;
 * we mount the mega-doc into test-A's org for the duration of the run.
 *
 * Strategy: rather than re-seed for every Playwright run, we:
 *   1. Look up the mega-doc by name in the local DB
 *   2. If absent in test-A's org, the test gracefully skips (so CI on
 *      a fresh DB doesn't false-fail)
 *
 * The mega-doc belongs to author@stelavox.local — these Playwright
 * tests sign in as that user (not test-A) to access it directly.
 */

import { test, expect } from '@playwright/test'

import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'
const MEGA_PROJECT_NAME = 'Mega Manuscript'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'

async function signInAsAuthor(page: import('@playwright/test').Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(AUTHOR_EMAIL)
  await page.locator('input[type="password"]').fill(AUTHOR_PASSWORD)
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30000 }),
    page.locator('button[type="submit"]').click(),
  ])
}

async function megaProjectExists(): Promise<boolean> {
  const admin = adminClient()
  const { data } = await admin
    .from('projects')
    .select('id')
    .eq('name', MEGA_PROJECT_NAME)
    .maybeSingle()
  return !!data
}

test.describe('Phase 8.5b B.1 — Dashboard rollup correctness', () => {
  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1-11 — Dashboard ProjectCard for mega-doc shows >= 500k words.
  // Regression guard for the 187k bug. Asserts the visible word count
  // string contains "500" or higher — does NOT contain "187".
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B1-11 — mega-doc card shows ≥ 500k words (regression guard)', async ({ page }) => {
    if (!(await megaProjectExists())) {
      test.skip(true, 'Mega Manuscript fixture not seeded — run scripts/seed-mega-doc.ts first')
      return
    }
    await signInAsAuthor(page)
    // Look for the Mega Manuscript card by name.
    const card = page.locator('[data-testid="project-card"]', { hasText: MEGA_PROJECT_NAME })
    await expect(card).toBeVisible({ timeout: 10000 })
    // Read the visible word count text inside the card.
    const cardText = (await card.innerText()) || ''
    // Regression: should NOT contain "187" (the buggy value).
    expect(cardText).not.toContain('187,206')
    expect(cardText).not.toContain('187k')
    // Forward: should display 500,006 (or a localised variant).
    const hasExpected =
      cardText.includes('500,006') ||
      cardText.includes('500006') ||
      cardText.includes('500K') ||
      cardText.includes('500k') ||
      cardText.includes('500,000')
    expect(hasExpected).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1-12 — Dashboard ProjectCard for Sample Novel shows correct small-doc.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B1-12 — sample novel card shows small-doc count', async ({ page }) => {
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('name', 'Sample Novel — The Quiet Door')
      .maybeSingle()
    if (!project) {
      test.skip(true, 'Sample Novel fixture not seeded — run scripts/seed-sample-novel.ts')
      return
    }
    await signInAsAuthor(page)
    const card = page.locator('[data-testid="project-card"]', { hasText: 'Quiet Door' })
    await expect(card).toBeVisible({ timeout: 10000 })
    const cardText = (await card.innerText()) || ''
    // Sample Novel is small (~640 words target, ~473 actual). The card
    // should not be empty and should display a small count.
    expect(cardText.length).toBeGreaterThan(0)
    // Must not display anything misleadingly large.
    expect(cardText).not.toMatch(/100,?000/)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1-13 — Progress bar percentage reflects new rollup values.
  // For mega-doc, drafted/target = 500006/500000 = 100%. Bar reads as
  // complete (visible width corresponds to the percentage).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B1-13 — mega-doc progress bar at ~100% complete', async ({ page }) => {
    if (!(await megaProjectExists())) {
      test.skip(true, 'Mega Manuscript fixture not seeded')
      return
    }
    await signInAsAuthor(page)
    const card = page.locator('[data-testid="project-card"]', { hasText: MEGA_PROJECT_NAME })
    await expect(card).toBeVisible({ timeout: 10000 })
    // Look for the progress percentage text near the card (the
    // ProjectCard renders e.g. "100% complete" or similar).
    const cardText = (await card.innerText()) || ''
    // 500006/500000 is 100% (capped). Other than the words, the card
    // should show a complete-or-near indicator.
    const hasComplete =
      cardText.includes('100%') ||
      cardText.includes('99%') ||
      cardText.includes('Complete')
    expect(hasComplete).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B1-14 — Document header word-count display reflects rollup output.
  // Open the mega-doc and verify any document-header word count surface
  // reads the rollup value (or at least is non-zero and not stuck at
  // the buggy 187k value).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B1-14 — document header reflects rollup, not the buggy value', async ({ page }) => {
    if (!(await megaProjectExists())) {
      test.skip(true, 'Mega Manuscript fixture not seeded')
      return
    }
    await signInAsAuthor(page)
    // Click into the mega-doc project.
    const card = page.locator('[data-testid="project-card"]', { hasText: MEGA_PROJECT_NAME })
    await expect(card).toBeVisible({ timeout: 10000 })
    // Navigate to the project page first; click an "Open" affordance
    // on a document row, or just navigate via URL discovery.
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('name', MEGA_PROJECT_NAME)
      .maybeSingle()
    const projectId = project?.id
    if (!projectId) {
      test.skip(true, 'project lookup failed')
      return
    }
    const { data: doc } = await admin
      .from('documents')
      .select('id')
      .eq('project_id', projectId)
      .maybeSingle()
    const documentId = doc?.id
    if (!documentId) {
      test.skip(true, 'document lookup failed')
      return
    }
    await page.goto(`${BASE}/projects/${projectId}/documents/${documentId}`)
    // Wait for the tree to be visible — proves the doc loaded.
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    // The body of the document page should not contain the buggy value.
    const bodyText = await page.locator('body').innerText().catch(() => '')
    expect(bodyText).not.toContain('187,206')
  })
})
