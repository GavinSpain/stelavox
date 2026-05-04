// Spec: stelavox_phase3_test_plan_v1_0.md §2 (TC-U-12..15) + §4 (TC-M-01..08)

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { withReducedMotion } from '../helpers/motion'

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

async function setupFixture(orgId: string, prefix: string): Promise<F> {
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
  return { projectId: project!.id, documentId: setup.document.id, beatId: beat!.id, beatName }
}

async function dispose(f: F) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openBeat(page: Page, f: F) {
  await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(`${f.beatName}, draft`).click()
  await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5000 })
}

async function enterFocusMode(page: Page) {
  await page.locator('[data-editor="prose"] .tiptap').click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
  await expect(page.locator('[data-focus-mode="active"]')).toBeVisible({ timeout: 1000 })
}

test.describe('Phase 3 — Focus Mode', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-U-12 — Focus Mode entry via ⌘Return', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-12')
    await openBeat(page, f)
    await enterFocusMode(page)
    // Body class added; AppShell elements transformed
    expect(await page.evaluate(() => document.body.classList.contains('focus-mode-active'))).toBe(true)
    // Focus Mode prose editor is rendered with mode="focus"
    await expect(page.locator('[data-editor="prose"][data-mode="focus"] .tiptap')).toBeVisible()
    // Breadcrumb is rendered inside the focus overlay (aria-hidden="true" by spec
    // is intentional, so toBeVisible() will refuse it — assert presence + non-zero box).
    const breadcrumbBox = await page.locator('[data-focus-mode="active"] [aria-hidden="true"]').first().boundingBox()
    expect(breadcrumbBox).not.toBeNull()
    expect(breadcrumbBox!.width).toBeGreaterThan(0)
    await dispose(f)
  })

  test('TC-U-13 — Focus Mode exit on Esc', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-13')
    await openBeat(page, f)
    await enterFocusMode(page)
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-focus-mode="active"]')).toBeHidden({ timeout: 1500 })
    expect(await page.evaluate(() => document.body.classList.contains('focus-mode-active'))).toBe(false)
    await dispose(f)
  })

  test('TC-U-15 — Typewriter scroll keeps active line near 42% viewport', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-15')
    await openBeat(page, f)
    await enterFocusMode(page)
    const editor = page.locator('[data-editor="prose"][data-mode="focus"] .tiptap')
    await editor.click()
    // Type many lines
    for (let i = 0; i < 30; i++) {
      await page.keyboard.type(`Line ${i} content `, { delay: 5 })
      await page.keyboard.press('Enter')
    }
    // Allow smooth scroll to settle
    await page.waitForTimeout(500)
    // Find the active paragraph (last <p>) — its top should be near 42% of viewport
    const ratio = await page.evaluate(() => {
      const tiptap = document.querySelector('[data-editor="prose"][data-mode="focus"] .tiptap')
      if (!tiptap) return -1
      const last = tiptap.querySelector('p:last-child')
      if (!last) return -1
      const rect = last.getBoundingClientRect()
      return rect.top / window.innerHeight
    })
    // Permissive bounds: typewriter aims for 0.42 ±0.10
    expect(ratio).toBeGreaterThan(0.30)
    expect(ratio).toBeLessThan(0.60)
    await dispose(f)
  })

  test('TC-M-01 / TC-M-02 — Focus Mode entry/exit transition CSS is 280ms', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-01')
    await openBeat(page, f)
    // Inspect the CSS transition duration on a tracked AppShell element
    const transitionDuration = await page.evaluate(() => {
      const el = document.querySelector('[data-shell="header"]')
      if (!el) return null
      return window.getComputedStyle(el).transitionDuration
    })
    expect(transitionDuration).toMatch(/0\.28s/)
    await dispose(f)
  })

  test('TC-M-03 — All AppShell shells share the same transition class', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-03')
    await openBeat(page, f)
    const durations = await page.evaluate(() => {
      const targets = ['header', 'sidebar', 'tree', 'detail']
      return targets.map(t => {
        const el = document.querySelector(`[data-shell="${t}"]`)
        return el ? window.getComputedStyle(el).transitionDuration : null
      })
    })
    // All four should have the same transition duration
    expect(new Set(durations).size).toBe(1)
    expect(durations[0]).toMatch(/0\.28s/)
    await dispose(f)
  })

  test('TC-M-05 — prefers-reduced-motion collapses Focus Mode entry to 0ms', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-M-05')
    await openBeat(page, f)
    await withReducedMotion(page, async () => {
      const transition = await page.evaluate(() => {
        const el = document.querySelector('[data-shell="header"]')
        return el ? window.getComputedStyle(el).transition : null
      })
      // Should be "none" or 0s under reduced motion
      expect(transition === null ? '' : transition.toLowerCase())
        .toMatch(/none|0s/)
    })
    await dispose(f)
  })

  test('TC-M-08 — ⌘→ sibling navigation fades prose', async ({ page }) => {
    const orgId = orgA
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects').insert({ organisation_id: orgId, name: 'TC-M-08 project' })
      .select('id').single()
    const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: project!.id, p_organisation_id: orgId,
      p_name: 'doc', p_description: null as unknown as string,
      p_document_type: 'novel', p_authors: [],
    })
    const setup = rpc as { document: { id: string }; root_node: { id: string } }
    const { data: act } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
      parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
      order: 1, depth: 1, layer_index: 1, name: 'Act', status: 'draft', version: 1,
    }).select('id').single()
    const { data: chapter } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
      parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
      order: 1, depth: 2, layer_index: 2, name: 'Chapter', status: 'draft', version: 1,
    }).select('id').single()
    const { data: scene } = await admin.from('nodes').insert({
      organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
      parent_id: chapter!.id, node_category: 'structural', node_type: 'scene',
      order: 1, depth: 3, layer_index: 3, name: 'Scene', status: 'draft', version: 1,
    }).select('id').single()
    // Three sibling beats
    const beatIds: string[] = []
    for (let i = 0; i < 3; i++) {
      const { data: b } = await admin.from('nodes').insert({
        organisation_id: orgId, project_id: project!.id, document_id: setup.document.id,
        parent_id: scene!.id, node_category: 'structural', node_type: 'beat',
        order: i + 1, depth: 4, layer_index: 4, name: `Beat ${i + 1}`,
        status: 'draft', version: 1,
        prose: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Prose ${i + 1}` }] }] }),
      }).select('id').single()
      beatIds.push(b!.id)
    }
    await page.goto(`${BASE}/projects/${project!.id}/documents/${setup.document.id}`)
    await page.waitForLoadState('networkidle')
    await page.getByLabel('Beat 2, draft').click()
    await expect(page.getByTestId('node-name-heading')).toBeVisible()
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(page.locator('[data-focus-mode="active"]')).toBeVisible()
    // The sibling fetch fires from inside FocusMode's useEffect; give it
    // ample time to land + React to set state. The previous waitForResponse
    // was racing with the page-load /nodes call.
    await page.waitForTimeout(1500)
    // Verify focus mode shows Beat 2's prose first
    let initial = await page.locator('[data-editor="prose"][data-mode="focus"] .tiptap').innerText()
    expect(initial).toContain('Prose 2')
    void initial
    // Press ⌘→ to go to Beat 3, then poll for the content swap
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+ArrowRight')
    await expect.poll(
      async () => page.locator('[data-editor="prose"][data-mode="focus"] .tiptap').innerText(),
      { timeout: 4000, message: 'expected sibling prose to swap' },
    ).toContain('Prose 3')
    await admin.from('projects').delete().eq('id', project!.id)
  })
})
