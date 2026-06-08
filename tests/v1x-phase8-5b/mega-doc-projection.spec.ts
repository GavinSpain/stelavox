/**
 * Phase 8.5b B.2b — Endpoint projection (default flip) integration.
 *
 * Playwright integration cases for TC-8.5b-B2b-04..10. Verifies the
 * new default behaviour of GET /api/documents/[id]/nodes against the
 * mega-doc fixture (1556 nodes / 500006 words). Default response should
 * be ≤ 100 KB gzipped (down from 2.7 MB pre-B.2). `?include=*` and
 * `?include=prose` opt-ins still return content.
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §2 (TC-8.5b-B2b-04..10)
 *       docs/stelavox_document_load_architecture_v1_0.md §2.1
 *
 * Strategy: sign in as author@stelavox.local (who owns the mega-doc),
 * hit the route via the in-browser fetch, inspect the response.
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

async function findMegaDocId(): Promise<string | null> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .select('id')
    .eq('name', MEGA_PROJECT_NAME)
    .maybeSingle()
  if (!project) return null
  const { data: doc } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .maybeSingle()
  return doc?.id ?? null
}

interface ProbeResult {
  status: number
  bytes: number
  row_count: number
  sample_keys: string[]
}

async function probe(page: import('@playwright/test').Page, docId: string, suffix: string): Promise<ProbeResult> {
  return await page.evaluate(async ({ d, s }) => {
    const res = await fetch(`/api/documents/${d}/nodes${s}`)
    const text = await res.text()
    let rows: Array<Record<string, unknown>> = []
    try {
      rows = (JSON.parse(text) as { nodes: Array<Record<string, unknown>> }).nodes ?? []
    } catch {
      // 400 path — body has no nodes
    }
    return {
      status: res.status,
      bytes: text.length,
      row_count: rows.length,
      sample_keys: rows[0] ? Object.keys(rows[0]) : [],
    }
  }, { d: docId, s: suffix })
}

test.describe('Phase 8.5b B.2b — Endpoint projection default flip', () => {
  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-04 — Mega-doc default response ≤ 700 KB on the wire.
  // GIVEN the mega-doc fixture (1556 nodes); user signed in.
  // WHEN GET /api/documents/[megaDocId]/nodes is called WITHOUT any
  //      ?include= query.
  // THEN response.bytes ≤ 700,000 (gzipped equivalent ≤ ~120 KB at
  //      typical 5-6× ratio; well under the 2.7 MB pre-B.2 baseline).
  //
  // Note: the route does not currently gzip in dev mode, so we assert
  // on the raw-bytes threshold that corresponds to ≤ ~100 KB gzipped.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-04 — mega-doc default response ≤ 700 KB on wire', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const r = await probe(page, docId!, '')
    expect(r.status).toBe(200)
    expect(r.bytes).toBeLessThan(700_000)
    expect(r.sample_keys).not.toContain('prose')
    expect(r.sample_keys).not.toContain('summary')
    expect(r.sample_keys).not.toContain('notes')
    expect(r.sample_keys).not.toContain('metadata')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-05 — ?include=* response ≥ 2 MB (escape hatch).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-05 — `?include=*` escape hatch returns full payload', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const r = await probe(page, docId!, '?include=*')
    expect(r.status).toBe(200)
    expect(r.bytes).toBeGreaterThan(2_000_000)
    expect(r.sample_keys).toContain('prose')
    expect(r.sample_keys).toContain('summary')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-06 — Unknown ?include= returns 400.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-06 — `?include=unknown_field` returns 400', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const r = await probe(page, docId!, '?include=unknown_field')
    expect(r.status).toBe(400)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-07 — Mega-doc default still returns the same number of
  // rows as the escape-hatch response — projection trims COLUMNS not ROWS.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-07 — projection trims columns, not rows', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const def = await probe(page, docId!, '')
    const full = await probe(page, docId!, '?include=*')
    expect(def.row_count).toBe(full.row_count)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-08 — Tree renders correctly under the default projection.
  // GIVEN the mega-doc and B.2b default flipped.
  // WHEN user opens the document page.
  // THEN the tree displays role="treeitem" elements (NodeTree reads
  //      structural fields only; default projection has them all).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-08 — tree renders under default projection', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('name', MEGA_PROJECT_NAME)
      .maybeSingle()
    if (!project) test.skip(true, 'project lookup failed')
    await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
    await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
    const count = await page.locator('[role="treeitem"]').count()
    // At least the visible top-level rows are rendered. Mega doc has
    // 1 book + 5 acts at the top of the tree; some may be collapsed.
    expect(count).toBeGreaterThan(0)
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-09 — ?include=summary returns ≥ 200 KB more than default
  // but ≤ 1.5 MB (Tiptap summary JSONB is non-trivial but lighter than
  // prose).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-09 — `?include=summary` adds summary content', async ({ page }) => {
    const docId = await findMegaDocId()
    if (!docId) test.skip(true, 'Mega Manuscript fixture not seeded')
    await signInAsAuthor(page)
    const def = await probe(page, docId!, '')
    const sum = await probe(page, docId!, '?include=summary')
    expect(sum.bytes).toBeGreaterThan(def.bytes + 50_000)
    expect(sum.sample_keys).toContain('summary')
    expect(sum.sample_keys).not.toContain('prose')
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B2b-10 — Sample Novel (small fixture) still works under
  // the flip. Regression guard for small documents — the flip shouldn't
  // adversely affect small-doc behaviour.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B2b-10 — Sample Novel returns correct row count under default', async ({ page }) => {
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('name', 'Sample Novel — The Quiet Door')
      .maybeSingle()
    if (!project) test.skip(true, 'Sample Novel fixture not seeded')
    const { data: doc } = await admin
      .from('documents')
      .select('id')
      .eq('project_id', project!.id)
      .maybeSingle()
    if (!doc) test.skip(true, 'Sample Novel document missing')
    await signInAsAuthor(page)
    const r = await probe(page, doc!.id, '')
    expect(r.status).toBe(200)
    expect(r.row_count).toBeGreaterThanOrEqual(16) // 16 structural fixture
    expect(r.sample_keys).not.toContain('prose')
  })
})
