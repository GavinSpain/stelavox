// Phase 8.01.B T-8 — Focus breadcrumb hover/touch reveal.
//
// Spec contract per Component Spec v2.21 §6.2:
//   - at-rest opacity 0.35 (up from v2.20's 0.2)
//   - hover bumps to 0.7
//   - position counter + leaf name appear only at 0.7
//   - bracketed segments render via LayerLabel (structured shape)
//   - pointer-events on the inner content stay 'none' — Inviolable
//
// Fixture builds a 3-layer document so the breadcrumb has Act + Chapter
// + Scene + Beat segments to render.

import { test, expect } from '@playwright/test'
import { USERS, APP_URL } from '../helpers/auth'
import { adminClient } from '../helpers/db'

test.use({ storageState: USERS.A.storageState })

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

interface Fixture {
  projectId: string
  documentId: string
  beatId: string
}

async function setupFixture(orgId: string, prefix: string): Promise<Fixture> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id').single()
  const projectId: string = project!.id

  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: projectId,
    p_organisation_id: orgId,
    p_name: `${prefix} doc`,
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const documentId = setup.document.id
  const bookId = setup.root_node.id

  async function insert(parentId: string, type: string, order: number, layerIdx: number, name: string) {
    const { data } = await admin
      .from('nodes')
      .insert({
        organisation_id: orgId, project_id: projectId, document_id: documentId,
        parent_id: parentId,
        node_category: 'structural', node_type: type,
        order, layer_index: layerIdx,
        name, status: 'draft', version: 1,
      })
      .select('id').single()
    return data!.id as string
  }

  const actId = await insert(bookId, 'act', 1, 1, 'Departure')
  const chapterId = await insert(actId, 'chapter', 1, 2, 'Cold Open')
  const sceneId = await insert(chapterId, 'scene', 1, 3, 'The Iron Ghost')
  const beatId = await insert(sceneId, 'beat', 1, 4, 'Anchor')
  return { projectId, documentId, beatId }
}

async function cleanup(f: Fixture): Promise<void> {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openFocusModeOnBeat(page: import('@playwright/test').Page, f: Fixture, beatName: string) {
  await page.goto(`${APP_URL}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  // Select the beat by aria-label (matches focus-mode.spec.ts pattern).
  await page.getByLabel(`${beatName}, draft`).click()
  await page.waitForSelector('[data-editor="prose"] .tiptap', { timeout: 10_000 })
  await page.locator('[data-editor="prose"] .tiptap').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.waitForSelector('[data-focus-mode="active"]', { timeout: 5_000 })
}

test('TC-8.01.B-B-1 Focus breadcrumb renders bracketed segments via LayerLabel', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupFixture(orgId, `pb-b1-${Date.now()}`)
  try {
    await openFocusModeOnBeat(page, f, 'Anchor')
    const breadcrumb = page.getByTestId('focus-breadcrumb')
    await expect(breadcrumb).toBeVisible()
    // At least the leaf segment ([Bt 1]) should be present; ancestors
    // appear after the ancestor-chain fetch completes.
    await expect(breadcrumb.locator('[data-testid="layer-label"][data-layer="beat"]')).toHaveCount(1)
    await expect(
      breadcrumb.locator('[data-testid="layer-label"][data-layer="beat"]'),
    ).toHaveText('[Bt 1]')
  } finally {
    await cleanup(f)
  }
})

test('TC-8.01.B-B-2 hover bumps opacity to 0.7 and reveals position counter + leaf name', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupFixture(orgId, `pb-b2-${Date.now()}`)
  try {
    await openFocusModeOnBeat(page, f, 'Anchor')
    const breadcrumb = page.getByTestId('focus-breadcrumb')
    await expect(breadcrumb).toBeVisible()

    // At rest: opacity 0.35; position counter and leaf name not visible.
    await expect(breadcrumb).toHaveAttribute('data-opacity-state', 'at-rest')
    await expect(breadcrumb.getByTestId('focus-breadcrumb-position')).toHaveCount(0)
    await expect(breadcrumb.getByTestId('focus-breadcrumb-leaf-name')).toHaveCount(0)

    // Hover → 0.7; reveal both.
    await breadcrumb.hover()
    await expect(breadcrumb).toHaveAttribute('data-opacity-state', 'revealed')
    await expect(breadcrumb.getByTestId('focus-breadcrumb-position')).toBeVisible()
    await expect(breadcrumb.getByTestId('focus-breadcrumb-leaf-name')).toBeVisible()
    // Position counter shape: "N / M". Leaf only beat, total 1.
    await expect(breadcrumb.getByTestId('focus-breadcrumb-position')).toHaveText('1 / 1')
    // Leaf name reveal shows the beat name.
    await expect(breadcrumb.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Anchor')
  } finally {
    await cleanup(f)
  }
})

test('TC-8.01.B-B-3 inner content has pointer-events: none (Inviolable: breadcrumb is never navigation)', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupFixture(orgId, `pb-b3-${Date.now()}`)
  try {
    await openFocusModeOnBeat(page, f, 'Anchor')
    const breadcrumb = page.getByTestId('focus-breadcrumb')
    // The inner span (the LayerLabel chain) must be non-interactive so
    // clicks pass through. The outer wrapper carries the hover handler.
    const inner = breadcrumb.locator('> span').first()
    const pe = await inner.evaluate((el) => window.getComputedStyle(el).pointerEvents)
    expect(pe).toBe('none')
  } finally {
    await cleanup(f)
  }
})
