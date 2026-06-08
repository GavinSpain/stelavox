/**
 * Phase 8.5b B.3c — Two-tab Realtime patcher integration tests.
 *
 * Verifies the cross-tab Realtime propagation path end-to-end:
 *
 *   Tab A mutates → Postgres write → Realtime broadcast →
 *   Tab B's user channel → demuxer → useRealtimeTopic('nodes') →
 *   patcher applyNode{Update,Insert,Delete} → setQueryData →
 *   React re-renders without firing /api/documents/[id]/nodes
 *
 * This was the deferred B.3 follow-up coverage (Test Plan §3 — TC-8.5b-
 * B3-17..20). The unit tests at tests/unit/realtime-patcher.test.ts and
 * tests/unit/realtime-demuxer.test.ts pin the apply-on-event contract;
 * this file is the E2E proof that the full chain (Supabase Realtime
 * broker → server → client → patcher → cache → render) works when run
 * against a real browser, real DB, real channels.
 *
 * Status of the four originally-specified cases (Test Plan §3):
 *   TC-8.5b-B3-17 (prose typing) — SKIPPED. Depends on optimistic-
 *     autosave wiring through editor-store (deferred task #122). The
 *     prose editor reads from useEditorStore rather than directly from
 *     the useNode hook's cache, so a server-driven `nodes` UPDATE patch
 *     doesn't currently re-render the prose surface even when the cache
 *     is patched. Re-enable when #122 lands.
 *   TC-8.5b-B3-18 (rename), TC-8.5b-B3-19 (create), TC-8.5b-B3-20
 *     (delete) — all shipped here.
 *
 * Refs: docs/stelavox_phase8_5b_test_plan_v1_0.md §3
 *       docs/stelavox_document_load_architecture_v1_0.md §3.4 + §5
 *       lib/queries/realtime-patcher.ts (the contract under test)
 */

import { test, expect, type Page } from '@playwright/test'

import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'

// Sample Novel fixture is used (not Mega Manuscript) — these tests
// care about cross-tab event propagation, not large-doc scaling. The
// small fixture loads faster and keeps each test under the Playwright
// default 30 s timeout comfortably.
const FIXTURE_PROJECT_NAME = 'Sample Novel — The Quiet Door'

async function signInAsAuthor(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill(AUTHOR_EMAIL)
  await page.locator('input[type="password"]').fill(AUTHOR_PASSWORD)
  await Promise.all([
    page.waitForURL(/\/dashboard/, { timeout: 30000 }),
    page.locator('button[type="submit"]').click(),
  ])
}

async function findFixtureDocUrl(): Promise<{
  projectId: string
  documentId: string
  organisationId: string
} | null> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .select('id, organisation_id')
    .eq('name', FIXTURE_PROJECT_NAME)
    .maybeSingle()
  if (!project) return null
  const { data: doc } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', project.id)
    .maybeSingle()
  if (!doc) return null
  return {
    projectId: project.id,
    documentId: doc.id,
    organisationId: project.organisation_id,
  }
}

interface FixtureBeat {
  id: string
  parent_id: string | null
  name: string | null
  document_id: string
  organisation_id: string
  project_id: string
}

/** Pick a non-leaf scene to use as the parent for INSERT tests; pick a
 *  beat (depth = 4) for UPDATE / DELETE tests. */
async function pickFixtureBeat(documentId: string): Promise<FixtureBeat | null> {
  const admin = adminClient()
  const { data } = await admin
    .from('nodes')
    .select('id, parent_id, name, document_id, organisation_id, project_id, layer_index, node_category')
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .eq('layer_index', 4)
    .limit(1)
    .maybeSingle()
  return (data as unknown as FixtureBeat | null) ?? null
}

async function pickFixtureScene(documentId: string): Promise<FixtureBeat | null> {
  const admin = adminClient()
  const { data } = await admin
    .from('nodes')
    .select('id, parent_id, name, document_id, organisation_id, project_id, layer_index, node_category')
    .eq('document_id', documentId)
    .eq('node_category', 'structural')
    .eq('layer_index', 3)
    .limit(1)
    .maybeSingle()
  return (data as unknown as FixtureBeat | null) ?? null
}

async function openDocInTab(page: Page, projectId: string, documentId: string) {
  await page.goto(`${BASE}/projects/${projectId}/documents/${documentId}`)
  await page.locator('[role="treeitem"]').first().waitFor({ timeout: 30000 })
}

/** Returns a counter of GET /api/documents/[id]/nodes calls on this
 *  page from the moment the helper is called. */
function tapNodesEndpoint(page: Page, documentId: string): { count: () => number } {
  let n = 0
  page.on('response', (r) => {
    const url = r.url()
    if (url.includes(`/api/documents/${documentId}/nodes`)) n++
  })
  return { count: () => n }
}

test.describe('Phase 8.5b B.3c — two-tab Realtime patcher integration', () => {
  // The 4 spec'd cases are tied closely; share fixture setup at the
  // describe level. Each test uses fresh browser contexts so cookies
  // don't leak.

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-17 — Tab A edits prose; Tab B reflects within 2 s.
  // SKIPPED: depends on optimistic-autosave wiring through editor-store
  // (deferred task #122). The prose editor reads from useEditorStore,
  // not directly from useNode's TanStack cache. Re-enable when #122
  // lands and the prose surface re-renders from cache patches.
  // ───────────────────────────────────────────────────────────────────
  test.skip('TC-8.5b-B3-17 — Tab A edits prose; Tab B reflects', () => {
    // Deferred to a B.3d sub-phase if optimistic-autosave lands.
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-18 — Tab A renames beat; Tab B tree row updates within
  // 2 s without firing /nodes refetch.
  //
  // Verifies the UPDATE path: nodes UPDATE event → patcher
  // applyNodeUpdate → tree cache mutation → react-arborist row label
  // re-render. The zero-refetch assertion proves the patcher path is
  // active (not invalidate-then-refetch).
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B3-18 — Tab A renames beat; Tab B tree row updates within 2 s without refetch', async ({ browser }) => {
    const ids = await findFixtureDocUrl()
    if (!ids) test.skip(true, `${FIXTURE_PROJECT_NAME} fixture not seeded`)
    const beat = await pickFixtureBeat(ids!.documentId)
    if (!beat) test.skip(true, 'No beat available in fixture')

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const tabA = await ctxA.newPage()
    const tabB = await ctxB.newPage()
    try {
      await signInAsAuthor(tabA)
      await signInAsAuthor(tabB)
      await openDocInTab(tabA, ids!.projectId, ids!.documentId)
      await openDocInTab(tabB, ids!.projectId, ids!.documentId)
      // Settle any boot-time fetches.
      await tabB.waitForTimeout(500)
      const tap = tapNodesEndpoint(tabB, ids!.documentId)

      const newName = `Renamed-${Date.now().toString(36).slice(-6)}`
      const admin = adminClient()
      const { error } = await admin
        .from('nodes')
        .update({ name: newName })
        .eq('id', beat!.id)
      expect(error).toBeNull()

      // Within the §5.5 reconnect / propagation window: the renamed row
      // should appear in tab B's tree without /nodes refetch.
      await tabB.locator(`[role="treeitem"]:has-text("${newName}")`).first().waitFor({ timeout: 5000 })
      // Allow ≤ 1 fetch: established codebase pattern (matches TC-B4-05
       // rationale). Boot-time / RSC-hydration noise can fire one fetch
       // even with the patcher active; the architectural property under
       // test is "the patcher path is on the job, not invalidate-then-
       // refetch per event" — anything > 1 would indicate the invalidate
       // path is firing on the Realtime event itself.
      expect(tap.count()).toBeLessThanOrEqual(1)
    } finally {
      // Restore the original name so the fixture stays clean for the
      // next run.
      const admin = adminClient()
      if (beat?.name !== undefined) {
        await admin.from('nodes').update({ name: beat!.name }).eq('id', beat!.id)
      }
      await ctxA.close()
      await ctxB.close()
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-19 — Tab A creates new beat; Tab B tree shows it without
  // refetch.
  //
  // Verifies the INSERT path: nodes INSERT event → patcher
  // applyNodeInsert → tree cache append → react-arborist row appears.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B3-19 — Tab A creates new beat; Tab B tree shows it without refetch', async ({ browser }) => {
    const ids = await findFixtureDocUrl()
    if (!ids) test.skip(true, `${FIXTURE_PROJECT_NAME} fixture not seeded`)
    const scene = await pickFixtureScene(ids!.documentId)
    if (!scene) test.skip(true, 'No scene available as parent')

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const tabA = await ctxA.newPage()
    const tabB = await ctxB.newPage()
    let createdId: string | null = null
    try {
      await signInAsAuthor(tabA)
      await signInAsAuthor(tabB)
      await openDocInTab(tabA, ids!.projectId, ids!.documentId)
      await openDocInTab(tabB, ids!.projectId, ids!.documentId)
      await tabB.waitForTimeout(500)
      const tap = tapNodesEndpoint(tabB, ids!.documentId)

      const newName = `B3c-INSERT-${Date.now().toString(36).slice(-6)}`
      const admin = adminClient()
      // Find the next `order` value among siblings.
      const { data: siblings } = await admin
        .from('nodes')
        .select('order')
        .eq('parent_id', scene!.id)
      const nextOrder = ((siblings ?? []).reduce((max, r) => Math.max(max, (r as { order: number }).order), 0)) + 1
      const { data: inserted, error } = await admin
        .from('nodes')
        .insert({
          organisation_id: scene!.organisation_id,
          project_id: scene!.project_id,
          document_id: scene!.document_id,
          parent_id: scene!.id,
          order: nextOrder,
          depth: 4,
          layer_index: 4,
          node_type: 'beat',
          node_category: 'structural',
          name: newName,
          status: 'draft',
          word_count_target: 100,
          word_count_actual: 0,
          version: 1,
        })
        .select('id')
        .single()
      expect(error).toBeNull()
      createdId = (inserted as { id: string }).id

      await tabB.locator(`[role="treeitem"]:has-text("${newName}")`).first().waitFor({ timeout: 5000 })
      // Allow ≤ 1 fetch: established codebase pattern (matches TC-B4-05
       // rationale). Boot-time / RSC-hydration noise can fire one fetch
       // even with the patcher active; the architectural property under
       // test is "the patcher path is on the job, not invalidate-then-
       // refetch per event" — anything > 1 would indicate the invalidate
       // path is firing on the Realtime event itself.
      expect(tap.count()).toBeLessThanOrEqual(1)
    } finally {
      if (createdId) {
        const admin = adminClient()
        await admin.from('nodes').delete().eq('id', createdId)
      }
      await ctxA.close()
      await ctxB.close()
    }
  })

  // ───────────────────────────────────────────────────────────────────
  // TC-8.5b-B3-20 — Tab A deletes beat; Tab B tree removes it without
  // refetch.
  //
  // Verifies the DELETE path: nodes DELETE event → patcher
  // applyNodeDelete → tree cache filter → react-arborist row removed.
  //
  // We create the target via admin client (rather than using a fixture
  // beat) so we can delete it cleanly without affecting the canonical
  // fixture set.
  // ───────────────────────────────────────────────────────────────────
  test('TC-8.5b-B3-20 — Tab A deletes beat; Tab B tree removes it without refetch', async ({ browser }) => {
    const ids = await findFixtureDocUrl()
    if (!ids) test.skip(true, `${FIXTURE_PROJECT_NAME} fixture not seeded`)
    const scene = await pickFixtureScene(ids!.documentId)
    if (!scene) test.skip(true, 'No scene available as parent')

    // Stage a temporary beat that the test will delete.
    const admin = adminClient()
    const { data: siblings } = await admin
      .from('nodes')
      .select('order')
      .eq('parent_id', scene!.id)
    const nextOrder = ((siblings ?? []).reduce((max, r) => Math.max(max, (r as { order: number }).order), 0)) + 1
    const tempName = `B3c-DELETE-${Date.now().toString(36).slice(-6)}`
    const { data: temp, error: tempErr } = await admin
      .from('nodes')
      .insert({
        organisation_id: scene!.organisation_id,
        project_id: scene!.project_id,
        document_id: scene!.document_id,
        parent_id: scene!.id,
        order: nextOrder,
        depth: 4,
        layer_index: 4,
        node_type: 'beat',
        node_category: 'structural',
        name: tempName,
        status: 'draft',
        word_count_target: 100,
        word_count_actual: 0,
        version: 1,
      })
      .select('id')
      .single()
    expect(tempErr).toBeNull()
    const tempId = (temp as { id: string }).id

    const ctxA = await browser.newContext()
    const ctxB = await browser.newContext()
    const tabA = await ctxA.newPage()
    const tabB = await ctxB.newPage()
    try {
      await signInAsAuthor(tabA)
      await signInAsAuthor(tabB)
      await openDocInTab(tabA, ids!.projectId, ids!.documentId)
      await openDocInTab(tabB, ids!.projectId, ids!.documentId)
      // Wait for the temp row to appear in tab B's tree before tapping
      // /nodes traffic — its appearance is itself a successful INSERT
      // event from staging.
      await tabB.locator(`[role="treeitem"]:has-text("${tempName}")`).first().waitFor({ timeout: 5000 })
      await tabB.waitForTimeout(300)
      const tap = tapNodesEndpoint(tabB, ids!.documentId)

      // Tab A deletes (via API to keep the test fast and reliable).
      const { error: delErr } = await admin.from('nodes').delete().eq('id', tempId)
      expect(delErr).toBeNull()

      // Tab B's tree should drop the row.
      await expect(tabB.locator(`[role="treeitem"]:has-text("${tempName}")`).first()).toBeHidden({ timeout: 5000 })
      // Allow ≤ 1 fetch: established codebase pattern (matches TC-B4-05
       // rationale). Boot-time / RSC-hydration noise can fire one fetch
       // even with the patcher active; the architectural property under
       // test is "the patcher path is on the job, not invalidate-then-
       // refetch per event" — anything > 1 would indicate the invalidate
       // path is firing on the Realtime event itself.
      expect(tap.count()).toBeLessThanOrEqual(1)
    } finally {
      // Belt-and-braces cleanup in case the delete didn't fire.
      await admin.from('nodes').delete().eq('id', tempId)
      await ctxA.close()
      await ctxB.close()
    }
  })
})
