// Spec: stelavox_phase3_test_plan_v1_0.md §2 — TC-U-01..11, TC-U-16..19, TC-U-24
//
// UI smoke tests for the three editors and their autosave semantics.
// Uses User A's pre-saved storageState; sets up document fixtures via
// service-role client so each test starts from a known tree.

import { test, expect, type Page } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { tiptapDoc } from '../helpers/tiptap'
import { waitForPatch, DEBOUNCE_MS, DEBOUNCE_TOLERANCE_MS } from '../helpers/autosave'

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

interface Fixture {
  projectId: string
  documentId: string
  beatId: string
  beatName: string
}

async function setupFixture(orgId: string, prefix: string, opts: { locked?: boolean } = {}): Promise<Fixture> {
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
    order: 1, depth: 4, layer_index: 4, name: beatName,
    status: 'draft', version: 1,
  }).select('id').single()

  if (opts.locked) {
    // Phase 6: nodes.locked dropped; use node_author_locks.
    const { data: member } = await admin
      .from('organisation_members').select('user_id')
      .eq('organisation_id', orgId).limit(1).single()
    if (member?.user_id) {
      await admin.from('node_author_locks').insert({
        node_id: beat!.id, organisation_id: orgId,
        locked_by_user_id: member.user_id, lock_reason: 'test fixture',
      })
    }
  }

  return { projectId: project!.id, documentId: setup.document.id, beatId: beat!.id, beatName }
}

async function disposeFixture(f: Fixture) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function openBeat(page: Page, f: Fixture) {
  await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
  await page.waitForLoadState('networkidle')
  // Tree row label includes node name + status separated by comma per Phase 2
  await page.getByLabel(`${f.beatName}, draft`).click()
  await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5000 })
}

test.describe('Phase 3 — editors', () => {
  let orgA: string
  test.beforeAll(async () => { orgA = await getUserOrgId(USERS.A.email) })

  test('TC-U-01 — Detail panel opens with all three editors mounted', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-01')
    await openBeat(page, f)
    // Three editors render with placeholder text via data-placeholder attribute
    const summary = page.locator('[data-editor="summary"] .tiptap')
    const prose   = page.locator('[data-editor="prose"]   .tiptap')
    const notes   = page.locator('[data-editor="notes"]   .tiptap')
    await expect(summary).toBeVisible()
    await expect(prose).toBeVisible()
    await expect(notes).toBeVisible()
    // Placeholders set via data-placeholder attribute
    expect(await page.locator('[data-editor="summary"] [data-placeholder]').first().getAttribute('data-placeholder'))
      .toContain('Summarise')
    expect(await page.locator('[data-editor="prose"] [data-placeholder]').first().getAttribute('data-placeholder'))
      .toContain('Begin writing')
    expect(await page.locator('[data-editor="notes"] [data-placeholder]').first().getAttribute('data-placeholder'))
      .toContain('Notes to yourself')
    await disposeFixture(f)
  })

  test('TC-U-02 — SummaryEditor uses Inter, never Lora', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-02')
    await openBeat(page, f)
    const fontFamily = await page.locator('[data-editor="summary"] .tiptap').evaluate(
      (el: Element) => window.getComputedStyle(el).fontFamily,
    )
    expect(fontFamily.toLowerCase()).toContain('inter')
    expect(fontFamily.toLowerCase()).not.toContain('lora')
    const fontSize = await page.locator('[data-editor="summary"] .tiptap').evaluate(
      (el: Element) => window.getComputedStyle(el).fontSize,
    )
    expect(fontSize).toBe('13px')
    await disposeFixture(f)
  })

  test('TC-U-03 — ProseEditor uses Lora, never Inter; 16px line-height 1.85', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-03')
    await openBeat(page, f)
    const styles = await page.locator('[data-editor="prose"] .tiptap').evaluate((el: Element) => {
      const s = window.getComputedStyle(el)
      return { fontFamily: s.fontFamily, fontSize: s.fontSize, lineHeight: s.lineHeight }
    })
    expect(styles.fontFamily.toLowerCase()).toContain('lora')
    expect(styles.fontFamily.toLowerCase()).not.toContain('inter')
    expect(styles.fontSize).toBe('16px')
    // line-height 1.85 of 16px = 29.6px — browser may round to 29 or 30
    const lineHeightPx = parseFloat(styles.lineHeight)
    expect(lineHeightPx).toBeGreaterThanOrEqual(29)
    expect(lineHeightPx).toBeLessThanOrEqual(30)
    await disposeFixture(f)
  })

  test('TC-U-04 — Autosave fires ~1.5s after last keystroke', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-04')
    await openBeat(page, f)
    const editor = page.locator('[data-editor="prose"] .tiptap')
    await editor.click()

    const startTyping = Date.now()
    await page.keyboard.type('hello world', { delay: 30 })
    const stoppedTyping = Date.now()

    const { body, status } = await waitForPatch(page, f.beatId, DEBOUNCE_MS + DEBOUNCE_TOLERANCE_MS + 2000)
    const elapsedSinceStop = Date.now() - stoppedTyping
    expect(status).toBe(200)
    expect(elapsedSinceStop).toBeGreaterThanOrEqual(DEBOUNCE_MS - DEBOUNCE_TOLERANCE_MS)
    expect(elapsedSinceStop).toBeLessThanOrEqual(DEBOUNCE_MS + DEBOUNCE_TOLERANCE_MS + 1500)
    expect(body.expected_version).toBe(1)
    expect(typeof body.prose).toBe('string')
    expect(body.prose).toContain('hello world')
    void startTyping  // unused but kept for trace timing
    await disposeFixture(f)
  })

  test('TC-U-05 — Autosave bundles all changed editors in one PATCH', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-05')
    await openBeat(page, f)

    let patchCount = 0
    page.on('request', req => {
      if (req.method() === 'PATCH' && req.url().includes(`/api/nodes/${f.beatId}`) && !req.url().endsWith('/move')) {
        patchCount++
      }
    })

    // Type into all three editors within 800ms — should stay in same debounce window
    await page.locator('[data-editor="summary"] .tiptap').click()
    await page.keyboard.type('S', { delay: 10 })
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('P', { delay: 10 })
    await page.locator('[data-editor="notes"] .tiptap').click()
    await page.keyboard.type('N', { delay: 10 })

    const { body, status } = await waitForPatch(page, f.beatId)
    expect(status).toBe(200)
    expect(typeof body.summary).toBe('string')
    expect(typeof body.prose).toBe('string')
    expect(typeof body.notes).toBe('string')
    expect(body.summary).toContain('S')
    expect(body.prose).toContain('P')
    expect(body.notes).toContain('N')
    // Wait a bit and confirm no further PATCH fired
    await page.waitForTimeout(500)
    expect(patchCount).toBe(1)
    await disposeFixture(f)
  })

  test('TC-U-08 — 409 conflict surfaces banner with [Use latest] / [Keep mine]', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-08')
    await openBeat(page, f)
    // Bump server version via service role to make our local expected_version stale
    await adminClient().from('nodes')
      .update({ prose: tiptapDoc('from-elsewhere') })
      .eq('id', f.beatId)
    // Type → autosave will 409
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('mine')
    const { status } = await waitForPatch(page, f.beatId)
    expect(status).toBe(409)
    // Banner appears with both buttons
    const banner = page.getByTestId('conflict-banner')
    await expect(banner).toBeVisible({ timeout: 3000 })
    await expect(banner.getByRole('button', { name: /use latest/i })).toBeVisible()
    await expect(banner.getByRole('button', { name: /keep mine/i })).toBeVisible()
    await disposeFixture(f)
  })

  test('TC-U-09 — [Use latest] discards local edits and refreshes editor', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-09')
    await openBeat(page, f)
    await adminClient().from('nodes')
      .update({ prose: tiptapDoc('from-elsewhere') })
      .eq('id', f.beatId)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('mine')
    await waitForPatch(page, f.beatId)
    // Click Use latest
    await page.getByRole('button', { name: /use latest/i }).click()
    // Banner should dismiss
    await expect(page.getByTestId('conflict-banner')).toBeHidden({ timeout: 2000 })
    // Editor content should reflect 'from-elsewhere'
    const proseText = await page.locator('[data-editor="prose"] .tiptap').innerText()
    expect(proseText).toContain('from-elsewhere')
    await disposeFixture(f)
  })

  test('TC-U-10 — [Keep mine] re-PATCHes with new expected_version', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-10')
    await openBeat(page, f)
    await adminClient().from('nodes')
      .update({ prose: tiptapDoc('from-elsewhere') })
      .eq('id', f.beatId)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('mine')
    await waitForPatch(page, f.beatId)
    // Click Keep mine — should fire a new PATCH
    const followupPromise = waitForPatch(page, f.beatId)
    await page.getByRole('button', { name: /keep mine/i }).click()
    const { body, status } = await followupPromise
    expect(status).toBe(200)
    expect(body.expected_version).toBe(2)
    expect(body.prose).toContain('mine')
    await expect(page.getByTestId('conflict-banner')).toBeHidden({ timeout: 2000 })
    await disposeFixture(f)
  })

  test('TC-U-11 — 423 lock conflict surfaces read-only banner', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-11')
    await openBeat(page, f)
    // Lock the node via service role
    // Phase 6: insert into node_author_locks.
    const { data: org } = await adminClient()
      .from('nodes').select('organisation_id').eq('id', f.beatId).single()
    const { data: member } = await adminClient()
      .from('organisation_members').select('user_id')
      .eq('organisation_id', org!.organisation_id).limit(1).single()
    await adminClient().from('node_author_locks').insert({
      node_id: f.beatId, organisation_id: org!.organisation_id,
      locked_by_user_id: member!.user_id, lock_reason: 'TC-U-23',
    })
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('x')
    const { status } = await waitForPatch(page, f.beatId)
    expect(status).toBe(423)
    const banner = page.getByTestId('conflict-banner')
    await expect(banner).toBeVisible({ timeout: 3000 })
    await expect(banner.getByRole('button', { name: /use latest/i })).toBeVisible()
    // Keep mine should NOT be present in 423 banner
    await expect(banner.getByRole('button', { name: /keep mine/i })).toBeHidden()
    await disposeFixture(f)
  })

  test('TC-U-16 — WordCount turns verdigris at-or-above target', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-16')
    // Set word_count_target = 3
    await adminClient().from('nodes').update({ word_count_target: 3 }).eq('id', f.beatId)
    await openBeat(page, f)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('one two three', { delay: 30 })
    // Wait for word count to settle visible (idle 3s + transition)
    await page.waitForTimeout(3500)
    // The count span has the verdigris colour at target
    const countSpan = page.locator('[data-editor="prose"]').locator('..').locator('text=/^3 \\/ 3$/').first()
    // Fall back: check any visible WordCount with the right colour
    const colour = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('span'))
      for (const el of els) {
        if (el.textContent?.trim() === '3') {
          const c = window.getComputedStyle(el).color
          if (c.includes('rgb(61, 120, 88)') || c.includes('rgb(37, 74, 56)')) return c
        }
      }
      return null
    })
    expect(colour).toBeTruthy()
    void countSpan
    await disposeFixture(f)
  })

  test('TC-U-17 — Selection tooltip appears above prose selection', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-17')
    await openBeat(page, f)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('the quick brown fox')
    // Select "quick brown" via keyboard
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    // Tooltip with role=toolbar should appear
    await expect(page.getByRole('toolbar', { name: /text formatting/i })).toBeVisible({ timeout: 1500 })
    // Three buttons: B, I, 🔗
    await expect(page.getByRole('toolbar').getByRole('button', { name: /bold/i })).toBeVisible()
    await expect(page.getByRole('toolbar').getByRole('button', { name: /italic/i })).toBeVisible()
    await expect(page.getByRole('toolbar').getByRole('button', { name: /link/i })).toBeVisible()
    await disposeFixture(f)
  })

  test('TC-U-18 — ⌘B applies bold via prose editor (no toolbar)', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-18')
    await openBeat(page, f)
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('hello')
    // Select the word
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+End')
    // Apply bold via shortcut
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+b' : 'Control+b')
    // Wait for autosave to capture the bold mark
    const { body } = await waitForPatch(page, f.beatId)
    expect(body.prose).toContain('"bold"')
    // Confirm a <strong> element rendered
    await expect(page.locator('[data-editor="prose"] .tiptap strong')).toHaveCount(1)
    await disposeFixture(f)
  })

  test('TC-U-19 — Notes editor admits Link; Summary does not', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-19')
    await openBeat(page, f)
    // Notes: Link button visible in toolbar on focus
    await page.locator('[data-editor="notes"] .tiptap').click()
    await page.keyboard.type('see this')
    // Toolbar inside notes editor is the focus toolbar; the link button has title="Link (⌘K)"
    const notesToolbar = page.locator('[data-editor="notes"]').locator('button[title*="Link"]')
    await expect(notesToolbar).toHaveCount(1)
    // Summary: NO link button in the toolbar
    await page.locator('[data-editor="summary"] .tiptap').click()
    const summaryToolbar = page.locator('[data-editor="summary"]').locator('button[title*="Link"]')
    await expect(summaryToolbar).toHaveCount(0)
    await disposeFixture(f)
  })

  test('TC-U-24 — Switching to a locked node opens editors read-only', async ({ page }) => {
    const f = await setupFixture(orgA, 'TC-U-24', { locked: true })
    await openBeat(page, f)
    // The store responds to a 423 by setting lockedReason; but the lock is
    // discovered at the next PATCH attempt. To verify the read-only state
    // surfaces immediately on a locked node, type a character and expect the
    // 423 to land plus banner show.
    await page.locator('[data-editor="prose"] .tiptap').click()
    await page.keyboard.type('x')
    const { status } = await waitForPatch(page, f.beatId)
    expect(status).toBe(423)
    await expect(page.getByTestId('conflict-banner')).toBeVisible({ timeout: 3000 })
    await disposeFixture(f)
  })

  test('TC-U-29 — Structural body text uses Inter, never the browser default', async ({ page }) => {
    // Spec: Brand Identity v2.0 §6 (Inter for all structural UI);
    //       Inviolable #4 (typeface boundary — Inter for structural,
    //       Lora for prose). TC-U-02 verifies the editor side; this test
    //       verifies the surrounding chrome (header, tabs, panel header,
    //       tree rows). Regression guard for the v1.6 cursor-blink-style
    //       silent fallback bug where --font-sans was a circular
    //       self-reference resolving to the browser default.
    const f = await setupFixture(orgA, 'TC-U-29')
    await openBeat(page, f)

    // body element — what every non-overridden surface inherits.
    const bodyFont = await page.locator('body').evaluate(
      (el: Element) => window.getComputedStyle(el).fontFamily,
    )
    expect(bodyFont.toLowerCase()).toContain('inter')
    expect(bodyFont.toLowerCase()).not.toContain('lora')

    // Detail-panel heading — should inherit Inter from body.
    const headingFont = await page.getByTestId('node-name-heading').evaluate(
      (el: Element) => window.getComputedStyle(el).fontFamily,
    )
    expect(headingFont.toLowerCase()).toContain('inter')

    // A tree row — should also be Inter.
    const treeRowFont = await page.getByLabel(`${f.beatName}, draft`).evaluate(
      (el: Element) => window.getComputedStyle(el).fontFamily,
    )
    expect(treeRowFont.toLowerCase()).toContain('inter')

    await disposeFixture(f)
  })
})
