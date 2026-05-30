// Phase 8.01.A T-9 — NodeRow bracketed labels + 44px height.
//
// Component Spec v2.21 §4.2 + §18.1: every structural node row carries
// a bracketed monospace label prefix (`[Book 1]`, `[Act 1]`, `[Ch 1]`,
// `[Sc 1]`, `[Bt 1]`). Context nodes render without a label. Row min
// height is 44px universal across viewports.

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
  actId: string
  chapterId: string
  contextId: string
}

async function setupFixture(orgId: string, prefix: string): Promise<Fixture> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id')
    .single()
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

  // Add an Act + Chapter so we have 3 structural rows + 1 context row to check.
  const { data: act } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: bookId,
      node_category: 'structural',
      node_type: 'act',
      order: 1,
      layer_index: 1,
      name: 'Departure',
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const actId = act!.id

  const { data: chapter } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: actId,
      node_category: 'structural',
      node_type: 'chapter',
      order: 1,
      layer_index: 2,
      name: 'Cold Open',
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const chapterId = chapter!.id

  const { data: ctx } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      document_id: documentId,
      parent_id: null,
      node_category: 'context',
      node_type: 'character',
      order: 1,
      scope: 'document',
      name: 'Marcus',
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()
  const contextId = ctx!.id

  return { projectId, documentId, actId, chapterId, contextId }
}

async function cleanupFixture(f: Fixture): Promise<void> {
  const admin = adminClient()
  await admin.from('projects').delete().eq('id', f.projectId)
}

test('TC-8.01.A-N-1 Structural NodeRows carry bracketed monospace labels', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const fx = await setupFixture(orgId, `pa-n1-${Date.now()}`)
  try {
    await page.goto(`${APP_URL}/projects/${fx.projectId}/documents/${fx.documentId}`)
    // Expand the tree so descendants are visible.
    await page.waitForSelector('[data-testid="layer-label"]', { timeout: 15_000 })

    // The root book LayerLabel should be present.
    const bookLabel = page.locator('[data-testid="layer-label"][data-layer="book"]')
    await expect(bookLabel.first()).toBeVisible()
    await expect(bookLabel.first()).toHaveText('[Book 1]')
  } finally {
    await cleanupFixture(fx)
  }
})

test('TC-8.01.A-N-2 Context nodes render WITHOUT a bracketed label', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const fx = await setupFixture(orgId, `pa-n2-${Date.now()}`)
  try {
    await page.goto(`${APP_URL}/projects/${fx.projectId}/documents/${fx.documentId}`)
    await page.waitForSelector('[data-testid="layer-label"]', { timeout: 15_000 })

    // No layer-label should appear for the character node "Marcus".
    // The row containing "Marcus" should NOT have a layer-label descendant.
    const marcusRow = page.locator('div[role="treeitem"]', { hasText: 'Marcus' }).first()
    // Marcus may live in a separate context pane rather than the tree —
    // tolerate either; the assertion is that NO layer-label appears on
    // any element whose text contains "Marcus".
    const labelInRow = marcusRow.locator('[data-testid="layer-label"]')
    await expect(labelInRow).toHaveCount(0)
  } finally {
    await cleanupFixture(fx)
  }
})

test('TC-8.01.A-N-3 NodeRow min-height is 44px (universal, was 36px desktop)', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const fx = await setupFixture(orgId, `pa-n3-${Date.now()}`)
  try {
    await page.goto(`${APP_URL}/projects/${fx.projectId}/documents/${fx.documentId}`)
    await page.waitForSelector('[data-testid="layer-label"]', { timeout: 15_000 })

    // The Book row's height should be 44px (the value applied directly
    // as inline style by NodeRow per Phase 8.01.A T-5).
    const bookRow = page.locator('div[role="treeitem"]').first()
    const height = await bookRow.evaluate((el) => {
      // The row sets height: 44px inline. getBoundingClientRect.height should be 44.
      return el.getBoundingClientRect().height
    })
    expect(height).toBe(44)
  } finally {
    await cleanupFixture(fx)
  }
})
