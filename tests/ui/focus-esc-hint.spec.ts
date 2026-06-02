// Phase 8.01.B T-8 — FocusEscHint position + touch variant.
//
// Desktop: "Esc to exit" bottom-LEFT (was bottom-right per v2.20).
// Touch:   "← Edit" 44×44 pill bottom-LEFT, persistent 0.4 opacity, tap fires exit.

import { test, expect } from '@playwright/test'
import { USERS, APP_URL } from '../helpers/auth'
import { adminClient } from '../helpers/db'

test.use({ storageState: USERS.A.storageState })

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)!
  const { data } = await admin
    .from('organisation_members').select('organisation_id').eq('user_id', user.id).single()
  return data!.organisation_id
}

async function setupBeat(orgId: string, prefix: string) {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects').insert({ organisation_id: orgId, name: `${prefix} project` })
    .select('id').single()
  const projectId: string = project!.id
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: projectId, p_organisation_id: orgId,
    p_name: `${prefix} doc`, p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const documentId = setup.document.id
  const bookId = setup.root_node.id
  async function ins(pid: string, type: string, ord: number, idx: number, name: string) {
    const { data } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: projectId, document_id: documentId,
      parent_id: pid, node_category: 'structural', node_type: type,
      order: ord, layer_index: idx, name, status: 'draft', version: 1,
    }).select('id').single()
    return data!.id as string
  }
  const a = await ins(bookId, 'act', 1, 1, 'A')
  const c = await ins(a, 'chapter', 1, 2, 'C')
  const s = await ins(c, 'scene', 1, 3, 'S')
  await ins(s, 'beat', 1, 4, 'B')
  return { projectId, documentId }
}

async function openFocus(page: import('@playwright/test').Page, projectId: string, documentId: string, beatName = 'B') {
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${beatName}, draft`).click()
  await page.waitForSelector('[data-editor="prose"] .tiptap', { timeout: 10_000 })
  await page.locator('[data-editor="prose"] .tiptap').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.waitForSelector('[data-focus-mode="active"]', { timeout: 5_000 })
}

test('TC-8.01.B-E-1 Desktop ESC hint renders bottom-left with "Esc to exit"', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupBeat(orgId, `pb-e1-${Date.now()}`)
  try {
    await openFocus(page, f.projectId, f.documentId)
    const hint = page.getByTestId('focus-esc-hint')
    await expect(hint).toHaveAttribute('data-variant', 'desktop')
    await expect(hint).toContainText('Esc to exit')
    // bottom-left positioning: left CSS is 32px.
    const left = await hint.evaluate((el) => window.getComputedStyle(el).left)
    expect(left).toBe('32px')
  } finally {
    await adminClient().from('projects').delete().eq('id', f.projectId)
  }
})

test('TC-8.01.B-E-2 Touch variant renders 44×44 pill that fires exit on tap', async ({ browser }) => {
  // Emulate coarse pointer with iPad device descriptors.
  const ctx = await browser.newContext({
    storageState: USERS.A.storageState,
    ...{ hasTouch: true, isMobile: true, viewport: { width: 1024, height: 768 } },
  })
  const page = await ctx.newPage()
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupBeat(orgId, `pb-e2-${Date.now()}`)
  try {
    await openFocus(page, f.projectId, f.documentId)
    const hint = page.getByTestId('focus-esc-hint')
    await expect(hint).toHaveAttribute('data-variant', 'touch')
    await expect(hint).toContainText('← Edit')
    // Pill is at least 44×44.
    const box = await hint.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
    // Tap exits Focus Mode.
    await hint.tap()
    await expect(page.locator('[data-focus-mode="active"]')).toHaveCount(0)
  } finally {
    await adminClient().from('projects').delete().eq('id', f.projectId)
    await ctx.close()
  }
})
