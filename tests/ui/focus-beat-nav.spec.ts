// Phase 8.01.B T-8 — Focus Mode beat navigation (⌘ ← / ⌘ →).
//
// Same-parent path: ⌘ → advances within the same scene.
// Cross-parent wrap: ⌘ → on the last beat of a scene jumps to the first
// beat of the next scene (per spec §6.1 + wireframe iter1 F-2).
// Stop-at-document-end: ⌘ ← on the very first beat no-ops.

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

interface BeatFixture {
  projectId: string
  documentId: string
  bt1: string
  bt2: string
  bt3: string // first beat of scene 2
  bt4: string // last beat of scene 2
}

// Build: Book → Act → Chapter → Scene1 (Bt1, Bt2) + Scene2 (Bt3, Bt4).
async function setupTwoSceneFixture(orgId: string, prefix: string): Promise<BeatFixture> {
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
  const actId = await ins(bookId,  'act',     1, 1, 'Departure')
  const chId  = await ins(actId,   'chapter', 1, 2, 'Cold Open')
  const sc1   = await ins(chId,    'scene',   1, 3, 'The Iron Ghost')
  const sc2   = await ins(chId,    'scene',   2, 3, 'The Back Room')
  const bt1   = await ins(sc1,     'beat',    1, 4, 'Anchor')
  const bt2   = await ins(sc1,     'beat',    2, 4, 'Watcher')
  const bt3   = await ins(sc2,     'beat',    1, 4, 'Entry')
  const bt4   = await ins(sc2,     'beat',    2, 4, 'Bargain')
  return { projectId, documentId, bt1, bt2, bt3, bt4 }
}

async function cleanup(f: BeatFixture): Promise<void> {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openFocusOnNamed(page: import('@playwright/test').Page, projectId: string, documentId: string, beatName: string) {
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${beatName}, draft`).click()
  await page.waitForSelector('[data-editor="prose"] .tiptap', { timeout: 10_000 })
  await page.locator('[data-editor="prose"] .tiptap').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await page.waitForSelector('[data-focus-mode="active"]', { timeout: 5_000 })
  // Give siblings fetch + initial render time to settle (the keydown handler's
  // useCallback closes over siblings; without a stable siblings array the
  // first navigateSibling call no-ops at idx<0).
  await page.waitForFunction(
    () => !!document.querySelector('[data-focus-mode="active"]'),
    { timeout: 5_000 },
  )
  await page.waitForTimeout(800)
  await page.getByTestId('focus-breadcrumb').hover()
}

test('TC-8.01.B-N-1 ⌘ → advances within the same scene (Anchor → Watcher)', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupTwoSceneFixture(orgId, `pb-n1-${Date.now()}`)
  try {
    await openFocusOnNamed(page, f.projectId, f.documentId, 'Anchor')
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Anchor')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
    // Navigation: 150ms fade-out + fetch + setState + ancestor refetch.
    await page.waitForTimeout(1200)
    await page.getByTestId('focus-breadcrumb').hover()
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Watcher', { timeout: 10_000 })
  } finally {
    await cleanup(f)
  }
})

test('TC-8.01.B-N-2 cross-parent wrap: ⌘ → on last beat of scene → first beat of next scene', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupTwoSceneFixture(orgId, `pb-n2-${Date.now()}`)
  try {
    await openFocusOnNamed(page, f.projectId, f.documentId, 'Watcher')
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Watcher')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
    await page.waitForTimeout(1200)
    await page.getByTestId('focus-breadcrumb').hover()
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Entry', { timeout: 10_000 })
  } finally {
    await cleanup(f)
  }
})

test('TC-8.01.B-N-3 stop-at-document-end: ⌘ ← on the first beat no-ops', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const f = await setupTwoSceneFixture(orgId, `pb-n3-${Date.now()}`)
  try {
    await openFocusOnNamed(page, f.projectId, f.documentId, 'Anchor')
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Anchor')
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Control+ArrowLeft')
    // 800ms gives the transition + ancestor refetch a chance to settle;
    // if a navigation HAD occurred we'd see a different leaf name.
    await page.waitForTimeout(800)
    await page.getByTestId('focus-breadcrumb').hover()
    await expect(page.getByTestId('focus-breadcrumb-leaf-name')).toContainText('Anchor')
  } finally {
    await cleanup(f)
  }
})
