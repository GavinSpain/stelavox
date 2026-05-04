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

  test('TC-U-21 — Hover diff preview shows added text underlined', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-21', [
      { prose: tiptapDoc('hello'),       reason: 'v1' },
      { prose: tiptapDoc('hello world'), reason: 'v2' },
    ])
    await openBeatAndHistory(page, f)
    // Hover over v1 row (the older one — last in the DESC list)
    await page.locator('[data-version-row="1"]').hover()
    // Tooltip with diff appears
    const tooltip = page.locator('[role="tooltip"]')
    await expect(tooltip).toBeVisible({ timeout: 3000 })
    // "world" should appear underlined (added)
    const underlinedText = await tooltip.evaluate(el => {
      const spans = el.querySelectorAll('span')
      return Array.from(spans)
        .filter(s => window.getComputedStyle(s).textDecorationLine.includes('underline'))
        .map(s => s.textContent)
        .join(' ')
    })
    expect(underlinedText).toContain('world')
    await dispose(f)
  })

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
})
