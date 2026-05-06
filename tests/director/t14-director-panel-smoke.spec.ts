// Phase 5b T-14 smoke — visual verification of DirectorPanel mount,
// ModeTabBar wiring, and ⌘. shortcut. Not part of the merge gate;
// produces screenshots into tests/.screenshots/t14/ for inspection.

import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'
const SHOT_DIR = resolve('tests/.screenshots/t14')

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

interface F {
  projectId: string
  documentId: string
}

async function setupFixture(orgId: string): Promise<F> {
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'T-14 Director smoke' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: orgId,
    p_name: 'T-14 doc',
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const setup = rpc as { document: { id: string } }
  return { projectId: project!.id, documentId: setup.document.id }
}

async function dispose(f: F) {
  await adminClient().from('projects').delete().eq('id', f.projectId)
}

async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false })
}

test.describe('Phase 5b T-14 — Director panel smoke', () => {
  let orgA: string
  test.beforeAll(async () => {
    orgA = await getUserOrgId(USERS.A.email)
  })

  test('Mode swap: Edit → Director (click) → Edit (⌘.)', async ({ page }) => {
    const f = await setupFixture(orgA)
    try {
      await page.goto(`${BASE}/projects/${f.projectId}/documents/${f.documentId}`)
      await page.waitForLoadState('networkidle')

      // Edit mode: ModeTabBar shows Edit selected, no DirectorPanel.
      const editTab = page.getByRole('tab', { name: 'Edit' })
      const directorTab = page.getByRole('tab', { name: 'Director' })
      await expect(editTab).toHaveAttribute('aria-selected', 'true')
      await expect(directorTab).toHaveAttribute('aria-selected', 'false')
      await shot(page, '01-edit-mode')

      // Click Director tab → DirectorPanel mounts in right slot.
      await directorTab.click()
      const panel = page.getByRole('complementary', { name: 'Director' })
      await expect(panel).toBeVisible({ timeout: 4000 })
      await expect(panel.locator('h2')).toContainText('The Director')
      await expect(directorTab).toHaveAttribute('aria-selected', 'true')
      await expect(editTab).toHaveAttribute('aria-selected', 'false')
      // Empty-state hint visible (no messages on a fresh conversation).
      await expect(
        panel.getByText('Start a conversation with the Director', { exact: false }),
      ).toBeVisible({ timeout: 4000 })
      await shot(page, '02-director-mode')

      // ⌘. (or Ctrl+. on non-mac) → toggles back to Edit.
      const meta = process.platform === 'darwin' ? 'Meta' : 'Control'
      await page.keyboard.press(`${meta}+Period`)
      await expect(editTab).toHaveAttribute('aria-selected', 'true')
      await expect(panel).toBeHidden({ timeout: 2000 })
      await shot(page, '03-back-to-edit')
    } finally {
      await dispose(f)
    }
  })
})
