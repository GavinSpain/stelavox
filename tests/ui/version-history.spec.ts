// Spec: stelavox_phase3_test_plan_v1_0.md §2 — TC-U-20..23

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'

const BASE = 'http://localhost:3000'

test.use({ storageState: USERS.A.storageState })

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find(u => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id).single()
  return data!.organisation_id
}

interface F {
  projectId: string
  documentId: string
  beatId: string
  beatName: string
}

async function setupFixture(
  orgId: string,
  prefix: string,
  versions: { prose: string; reason: string }[],
): Promise<F> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects').insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id').single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id, p_organisation_id: orgId,
    p_name: `${prefix} doc`, p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const { data: act } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: `${prefix} A`, status: 'draft', version: 1,
  }).select('id').single()
  const { data: chapter } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: `${prefix} C`, status: 'draft', version: 1,
  }).select('id').single()
  const { data: scene } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: chapter!.id, node_category: 'structural', node_type: 'scene',
    order: 1, depth: 3, layer_index: 3, name: `${prefix} S`, status: 'draft', version: 1,
  }).select('id').single()
  const beatName = `${prefix} Beat`
  const { data: beat } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
    parent_id: scene!.id, node_category: 'structural', node_type: 'beat',
    order: 1, depth: 4, layer_index: 4, name: beatName, status: 'draft', version: 1,
  }).select('id').single()
  for (let i = 0; i < versions.length; i++) {
    await admin.from('node_versions').insert({
      node_id: beat!.id, organisation_id: orgId, version: i + 1,
      prose: versions[i].prose,
      changed_by: 'agent_synthesise',
      change_reason: versions[i].reason,
    })
  }
  return { projectId: project!.id, documentId: setup.document.id, beatId: beat!.id, beatName }
}

async function openBeatAndHistory(page: Page, f: F) {
  await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${f.beatName}, draft`).click()
  await expect(page.getByTestId('node-name-heading')).toBeVisible()
  await page.getByRole('tab', { name: 'History' }).click()
}

async function dispose(f: F) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

test.describe('Phase 3 — Version history', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-U-20 — list renders newest first; current version starred; no Restore', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-20', [
      { prose: tiptapDoc('one'),   reason: 'first' },
      { prose: tiptapDoc('two'),   reason: 'second' },
      { prose: tiptapDoc('three'), reason: 'third' },
    ])
    await openBeatAndHistory(page, f)
    // Three rows visible
    await expect(page.locator('[data-version-row]')).toHaveCount(3)
    // First row in DOM order = newest = v3
    const firstRow = page.locator('[data-version-row]').first()
    await expect(firstRow).toHaveAttribute('data-version-row', '3')
    // Star aria-label="Current version" appears on the first row only
    await expect(firstRow.locator('[aria-label="Current version"]')).toHaveCount(1)
    await expect(page.locator('[aria-label="Current version"]')).toHaveCount(1)
    // No Restore button anywhere
    await expect(page.getByRole('button', { name: /restore/i })).toHaveCount(0)
    await dispose(f)
  })

  // TC-U-21 (Hover diff preview) — SUPERSEDED by v2.20 amendment.
  // The hover-diff tooltip was removed; the click-to-preview pane
  // covered by TC-U-24..28 is now the single inspection surface.
  // Kept as a skipped placeholder so test numbering stays stable in
  // historical reports.
  test.skip('TC-U-21 — Hover diff preview (SUPERSEDED in v2.20)', async () => {})

  test('TC-U-22 — Show N more pagination loads next batch', async ({ page }) => {
    const versions = []
    for (let i = 1; i <= 12; i++) {
      versions.push({ prose: tiptapDoc(`v${i}`), reason: `r${i}` })
    }
    const f = await setupFixture(orgA, 'TC-U-22', versions)
    await openBeatAndHistory(page, f)
    // Initial: 7 rows visible
    await expect(page.locator('[data-version-row]')).toHaveCount(7)
    // "Show 5 more" link visible
    const showMore = page.getByRole('button', { name: /show .* more/i })
    await expect(showMore).toBeVisible()
    await showMore.click()
    // Now 12 rows visible
    await expect(page.locator('[data-version-row]')).toHaveCount(12)
    // Show more disappears
    await expect(page.getByRole('button', { name: /show .* more/i })).toHaveCount(0)
    await dispose(f)
  })

  test('TC-U-23 — Empty version list shows agent-records-Phase-5 message', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-23', [])
    await openBeatAndHistory(page, f)
    await expect(page.getByText(/Versions are recorded when the agent revises this node/)).toBeVisible()
    await expect(page.locator('[data-version-row]')).toHaveCount(0)
    await dispose(f)
  })

  // ─────────────────────────────────────────────────────────────
  // VersionHistory v2.19 amendment — click-to-preview pane
  // ─────────────────────────────────────────────────────────────

  test('TC-U-24 — Empty preview pane shown when nothing selected', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-24', [
      { prose: tiptapDoc('alpha'), reason: 'v1' },
      { prose: tiptapDoc('beta'),  reason: 'v2' },
    ])
    await openBeatAndHistory(page, f)
    // Preview empty-state visible by default.
    await expect(page.getByTestId('version-preview-empty')).toBeVisible()
    await expect(page.getByTestId('version-preview-pane')).toHaveCount(0)
    await dispose(f)
  })

  test('TC-U-25 — Clicking a row renders the preview pane with that version content', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-25', [
      { prose: tiptapDoc('first version prose'),  reason: 'v1' },
      { prose: tiptapDoc('second version prose'), reason: 'v2' },
    ])
    await openBeatAndHistory(page, f)
    await page.locator('[data-version-row="1"]').click()
    const pane = page.getByTestId('version-preview-pane')
    await expect(pane).toBeVisible()
    await expect(pane).toHaveAttribute('data-preview-version', '1')
    await expect(pane.getByText('first version prose')).toBeVisible()
    // Selected row carries data-version-selected=true; sibling does not.
    await expect(page.locator('[data-version-row="1"]')).toHaveAttribute('data-version-selected', 'true')
    await expect(page.locator('[data-version-row="2"]')).toHaveAttribute('data-version-selected', 'false')
    await dispose(f)
  })

  test('TC-U-26 — Clicking another row swaps the preview content', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-26', [
      { prose: tiptapDoc('aardvark'), reason: 'v1' },
      { prose: tiptapDoc('zebra'),    reason: 'v2' },
    ])
    await openBeatAndHistory(page, f)
    await page.locator('[data-version-row="1"]').click()
    await expect(page.getByTestId('version-preview-pane').getByText('aardvark')).toBeVisible()
    await page.locator('[data-version-row="2"]').click()
    const pane = page.getByTestId('version-preview-pane')
    await expect(pane).toHaveAttribute('data-preview-version', '2')
    await expect(pane.getByText('zebra')).toBeVisible()
    await expect(pane.getByText('aardvark')).toHaveCount(0)
    await dispose(f)
  })

  test('TC-U-27 — Clicking the selected row again deselects it (back to empty pane)', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-27', [
      { prose: tiptapDoc('content'), reason: 'v1' },
    ])
    await openBeatAndHistory(page, f)
    await page.locator('[data-version-row="1"]').click()
    await expect(page.getByTestId('version-preview-pane')).toBeVisible()
    await page.locator('[data-version-row="1"]').click()
    await expect(page.getByTestId('version-preview-pane')).toHaveCount(0)
    await expect(page.getByTestId('version-preview-empty')).toBeVisible()
    await dispose(f)
  })

  test('TC-U-28 — Restore button click does NOT toggle selection (event propagation stopped)', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-28', [
      { prose: tiptapDoc('older'), reason: 'v1' },
      { prose: tiptapDoc('newer'), reason: 'v2' },
    ])
    await openBeatAndHistory(page, f)
    await page.locator('[data-version-row="1"]').hover()
    // Restore button is hover-visible (per Phase 6.C spec). Click it,
    // confirm the row is NOT selected as a side-effect, the modal
    // opens. We click Cancel on the modal to keep the test isolated.
    const restoreBtn = page.getByTestId('version-restore-1')
    await expect(restoreBtn).toBeVisible()
    await restoreBtn.click()
    // RestoreConfirmModal should open; the row stays unselected.
    await expect(page.locator('[data-version-row="1"]')).toHaveAttribute('data-version-selected', 'false')
    // Close the modal — Cancel button label per RestoreConfirmModal spec.
    const cancel = page.getByRole('button', { name: /cancel/i })
    if (await cancel.count() > 0) await cancel.first().click()
    await dispose(f)
  })
})
