// Spec: stelavox_phase3_test_plan_v1_0.md v1.1 §2 — TC-U-25..28
//       stelavox_component_specification_v2_2.md §4.2 / §5.1 / §5.4 / §6.1
//       stelavox_technical_architecture_v1_6.md H-15

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

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
  actName: string
  actId: string
  chapterName: string
  chapterId: string
  beatName: string
  beatId: string
}

async function setupHierarchy(orgId: string, prefix: string): Promise<F> {
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

  async function insert(parent_id: string, node_type: string, depth: number, layer_index: number, name: string, order = 1) {
    const { data } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
      parent_id, node_category: 'structural', node_type, order, depth, layer_index,
      name, status: 'draft', version: 1,
    }).select('id').single()
    return data!.id
  }

  const actName     = `${prefix} A`
  const actId       = await insert(setup.root_node.id, 'act',     1, 1, actName)
  const chapterName = `${prefix} C`
  const chapterId   = await insert(actId,              'chapter', 2, 2, chapterName)
  const sceneId     = await insert(chapterId,          'scene',   3, 3, `${prefix} S`)
  const beatName    = `${prefix} Beat`
  const beatId      = await insert(sceneId,            'beat',    4, 4, beatName)

  return {
    projectId: project!.id, documentId: setup.document.id,
    actName, actId, chapterName, chapterId, beatName, beatId,
  }
}

async function dispose(f: F) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openNode(page: Page, f: F, nodeName: string) {
  await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${nodeName}, draft`).click()
  await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5000 })
}

test.describe('Phase 3 v1.1 — leaf-aware UI gating', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-U-25 — Detail panel on a non-leaf renders Summary + Metadata + Notes only', async ({ page }) => {
    const f = await setupHierarchy(orgA, 'TC-U-25')
    await openNode(page, f, f.chapterName)
    // Click the Content tab to be explicit (it's the default but defensive)
    await page.getByRole('tab', { name: 'Content' }).click()

    // Structural editors render
    await expect(page.locator('[data-editor="summary"] .tiptap')).toBeVisible()
    await expect(page.locator('[data-editor="notes"] .tiptap')).toBeVisible()

    // Prose group is suppressed
    await expect(page.locator('[data-editor="prose"]')).toHaveCount(0)
    await expect(page.getByText(/Focus Mode/)).toHaveCount(0)
    await expect(page.getByTestId('word-count')).toHaveCount(0)

    await dispose(f)
  })

  test('TC-U-26 — Detail panel on a leaf renders the full editor stack', async ({ page }) => {
    const f = await setupHierarchy(orgA, 'TC-U-26')
    await openNode(page, f, f.beatName)
    // All three editor surfaces mount
    await expect(page.locator('[data-editor="summary"] .tiptap')).toBeVisible()
    await expect(page.locator('[data-editor="prose"][data-mode="edit"] .tiptap')).toBeVisible()
    await expect(page.locator('[data-editor="notes"] .tiptap')).toBeVisible()
    await expect(page.getByText(/Focus Mode/)).toBeVisible()
    await expect(page.getByTestId('word-count')).toHaveCount(1)
    await dispose(f)
  })

  test('TC-U-27 — NodeRow + Add child button hidden on leaves, visible on non-leaves', async ({ page }) => {
    const f = await setupHierarchy(orgA, 'TC-U-27')
    await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
    await page.waitForLoadState('networkidle')

    // Hover the Act row → + button visible
    await page.getByLabel(`${f.actName}, draft`).hover()
    await expect(
      page.getByLabel(`${f.actName}, draft`).getByLabel('Add child'),
    ).toBeVisible()

    // Hover the Beat row → + button hidden (rendered: 0 elements)
    await page.getByLabel(`${f.beatName}, draft`).hover()
    await expect(
      page.getByLabel(`${f.beatName}, draft`).getByLabel('Add child'),
    ).toHaveCount(0)

    await dispose(f)
  })

  test('TC-U-28 — ⌘Return on a non-leaf does not enter Focus Mode', async ({ page }) => {
    const f = await setupHierarchy(orgA, 'TC-U-28')
    await openNode(page, f, f.chapterName)
    // Focus the Summary editor (the only prose-like surface available on a non-leaf)
    await page.locator('[data-editor="summary"] .tiptap').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    // Tiny wait — Focus Mode mounts within ~50ms in normal flow
    await page.waitForTimeout(300)
    await expect(page.locator('[data-focus-mode="active"]')).toHaveCount(0)
    await dispose(f)
  })
})
