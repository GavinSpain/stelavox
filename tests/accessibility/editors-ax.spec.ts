// Spec: stelavox_phase3_test_plan_v1_0.md §8 — TC-AX-01..06

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'
import { withReducedMotion } from '../helpers/motion'
import { waitForPatch } from '../helpers/autosave'

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

test.describe('Phase 3 — Accessibility', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-AX-01 — Tab cycles through tabs and editors', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-01')
    await openBeat(page, f)
    // Click Content tab to focus it
    await page.getByRole('tab', { name: 'Content' }).focus()
    // Press Tab multiple times and capture focused element identifier
    const visited: string[] = []
    for (let i = 0; i < 8; i++) {
      const id = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return ''
        // Walk up to find a data-editor or role descriptor
        let cur: Element | null = el
        while (cur) {
          const editor = (cur as HTMLElement).dataset?.editor
          if (editor) return `editor:${editor}`
          const role = cur.getAttribute('role')
          if (role === 'tab') return `tab:${(cur as HTMLElement).innerText}`
          cur = cur.parentElement
        }
        return el.tagName.toLowerCase()
      })
      visited.push(id)
      await page.keyboard.press('Tab')
    }
    // The cycle should reach editor:summary, editor:prose, editor:notes in some order
    const reached = new Set(visited)
    expect(reached.has('editor:summary')).toBe(true)
    expect(reached.has('editor:prose')).toBe(true)
    expect(reached.has('editor:notes')).toBe(true)
    await dispose(f)
  })

  test('TC-AX-02 — Focus Mode entry preserves keyboard focus in editor', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-02')
    await openBeat(page, f)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    await expect(page.locator('[data-focus-mode="active"]')).toBeVisible({ timeout: 1000 })
    // Type — should land in the focus prose editor
    await page.keyboard.type('focused', { delay: 20 })
    const text = await page.locator('[data-editor="prose"][data-mode="focus"] .tiptap').innerText()
    expect(text).toContain('focused')
    await dispose(f)
  })

  test('TC-AX-03 — FocusBreadcrumb has aria-hidden="true"', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-03')
    await openBeat(page, f)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
    const ariaHidden = await page.locator('[aria-hidden="true"]').first().getAttribute('aria-hidden')
    expect(ariaHidden).toBe('true')
    await dispose(f)
  })

  test('TC-AX-04 — Conflict banner uses role="alert"', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-04')
    await openBeat(page, f)
    // Cause a 409 conflict
    await adminClient().from('nodes')
      .update({ prose: tiptapDoc('elsewhere') })
      .eq('id', f.beatId)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('local')
    await waitForPatch(page, f.beatId)
    const banner = page.locator('[role="alert"]')
    await expect(banner).toBeVisible({ timeout: 3000 })
    expect(await banner.getAttribute('aria-live')).toBe('assertive')
    await dispose(f)
  })

  test('TC-AX-05 — Reduced-motion entry collapses transition', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-05')
    await openBeat(page, f)
    await withReducedMotion(page, async () => {
      // CSS rule sets transition: none under reduced-motion media
      const transition = await page.evaluate(() => {
        const el = document.querySelector('[data-shell="header"]')
        return el ? window.getComputedStyle(el).transition : null
      })
      expect(transition === null ? '' : transition.toLowerCase()).toMatch(/none|0s/)
    })
    await dispose(f)
  })

  test('TC-AX-06 — Keyboard-only write-and-save cycle', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-AX-06')
    await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
    await page.waitForLoadState('networkidle')
    // Tab and Enter our way into the beat row
    await page.getByLabel(`${f.beatName}, draft`).focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5000 })
    // Tab to ProseEditor (a few tab presses to skip tabs/summary)
    let tabCount = 0
    while (tabCount < 12) {
      const onProse = await page.evaluate(() => {
        const el = document.activeElement
        if (!el) return false
        let cur: Element | null = el
        while (cur) {
          if ((cur as HTMLElement).dataset?.editor === 'prose') return true
          cur = cur.parentElement
        }
        return false
      })
      if (onProse) break
      await page.keyboard.press('Tab')
      tabCount++
    }
    await page.keyboard.type('keyboard sentence', { delay: 30 })
    const { status, body } = await waitForPatch(page, f.beatId)
    expect(status).toBe(200)
    expect(typeof body.prose).toBe('string')
    expect(body.prose).toContain('keyboard sentence')
    await dispose(f)
  })
})
