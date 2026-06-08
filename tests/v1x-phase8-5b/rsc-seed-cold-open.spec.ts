/**
 * Phase 8.5b B.4 — RSC initial seed integration tests.
 *
 * Verifies the document page server component prefetches structural
 * nodes into a per-request QueryClient and dehydrates into the
 * HydrationBoundary so the client tree reads from cache on first paint.
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §4 (TC-8.5b-B4-01..06)
 *       docs/stelavox_document_load_architecture_v1_0.md §3.6
 *
 * The mega-doc fixture is the scaling target; Sample Novel is the
 * smoke check that small docs still render correctly under the
 * dehydrated boundary.
 */

import { test, expect } from '@playwright/test'

import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'
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

async function findDocUrl(projectName: string): Promise<{ projectId: string; documentId: string } | null> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects').select('id').eq('name', projectName).maybeSingle()
  if (!project) return null
  const { data: doc } = await admin
    .from('documents').select('id').eq('project_id', project.id).maybeSingle()
  if (!doc) return null
  return { projectId: project.id, documentId: doc.id }
}

test.describe('Phase 8.5b B.4 — RSC initial seed', () => {
  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-01 — Cold doc HTML contains the dehydrated query state.
  // GIVEN signed-in session AND mega-doc fixture seeded.
  // WHEN user navigates directly to the doc URL.
  // THEN the HTML response body contains a marker indicating the
  //      dehydrated state was serialised (TanStack stamps either
  //      "dehydratedState" or "queryKey" depending on version).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-01 — cold doc HTML contains dehydrated query state', async ({ page }) => {
    const ids = await findDocUrl('Mega Manuscript')
    if (!ids) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    const html = await page.content()
    const hasMarker = html.includes('dehydratedState') || html.includes('queryKey')
    expect(hasMarker).toBe(true)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-02 — Cold doc open issues ZERO client-side /nodes fetch.
  // GIVEN mega-doc fixture + signed in.
  // WHEN user navigates to the doc URL fresh (no warm cache).
  // THEN no `/api/documents/[id]/nodes` request fires before the first
  //      treeitem is visible.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-02 — cold doc open: zero client /nodes fetch', async ({ page }) => {
    const ids = await findDocUrl('Mega Manuscript')
    if (!ids) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    let nodesCallCount = 0
    page.on('response', (r) => {
      if (r.url().includes('/api/documents/') && r.url().includes('/nodes')) {
        nodesCallCount++
      }
    })
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    expect(nodesCallCount).toBe(0)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-03 — Cold doc open total time within budget.
  // GIVEN dev mode (CI runs against dev server; production-build mode
  //       is hand-verified at sub-phase close).
  // WHEN user navigates cold to mega-doc.
  // THEN first treeitem visible within 6 s (loose dev-mode budget;
  //      Tier-A §8 spec target is < 2 s p50 in production-build mode).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-03 — cold doc open total time within dev-mode budget', async ({ page }) => {
    const ids = await findDocUrl('Mega Manuscript')
    if (!ids) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const start = Date.now()
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(6_000)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-04 — After cold open, clicking a tree row works.
  // GIVEN cold open complete via RSC seed.
  // WHEN user clicks the first treeitem AND waits.
  // THEN the detail-pane title row becomes visible.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-04 — after cold open, click works as expected', async ({ page }) => {
    const ids = await findDocUrl('Mega Manuscript')
    if (!ids) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    const rows = await page.locator('[role="treeitem"]').all()
    if (rows.length === 0) test.skip(true, 'no tree rows')
    await rows[0]!.click()
    await page.locator('[data-testid="detail-title-row"]').first().waitFor({ timeout: 10000 })
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-05 — Cache stays primary source within staleTime window.
  // GIVEN cold doc open complete via RSC seed.
  // WHEN user waits 5 s without interacting.
  // THEN at most 1 /api/documents/[id]/nodes fetch fires (the cache is
  //      the source of truth; an occasional Realtime-driven or boot-
  //      effect refetch is acceptable; B.5's multiplex demuxer will
  //      tighten this further).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-05 — cache stays primary source within staleTime window', async ({ page }) => {
    const ids = await findDocUrl('Mega Manuscript')
    if (!ids) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    // Wait for any potential boot-time fetches to settle.
    await page.waitForTimeout(500)
    let nodesCallCount = 0
    page.on('response', (r) => {
      if (r.url().includes('/api/documents/') && r.url().includes('/nodes')) {
        nodesCallCount++
      }
    })
    await page.waitForTimeout(5000)
    expect(nodesCallCount).toBeLessThanOrEqual(1)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B4-06 — Sample Novel (small fixture) renders under RSC seed.
  // GIVEN Sample Novel seeded.
  // WHEN user navigates to its doc URL.
  // THEN the tree renders correctly (regression guard for small docs).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B4-06 — Sample Novel renders under RSC seed', async ({ page }) => {
    const ids = await findDocUrl('Sample Novel — The Quiet Door')
    if (!ids) test.skip(true, 'Sample Novel not seeded')
    await signInAsAuthor(page)
    await page.goto(`${BASE}/projects/${ids!.projectId}/documents/${ids!.documentId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    const count = await page.locator('[role="treeitem"]').count()
    expect(count).toBeGreaterThan(0)
  })
})
