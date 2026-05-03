// Interactive smoke test for the More menu (T-4.6) + hide-delete-on-
// root (T-4.8). Builds a 3-node fixture and exercises the menu.

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

const BASE = 'http://localhost:3000'

async function getUserOrgId(email: string): Promise<string> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find(u => u.email === email)!
  const { data } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user.id)
    .single()
  return data!.organisation_id
}

test.use({ storageState: USERS.A.storageState })

test('More menu: status change refreshes tree; root has no delete', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'More Menu Smoke' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            'More Menu Doc',
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id
  const rootId = setup.root_node.id

  const { data: act } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: rootId, node_category: 'structural', node_type: 'act',
      order: 1, depth: 1, layer_index: 1, name: 'Act for Menu', status: 'draft', version: 1,
    })
    .select('id')
    .single()

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Hover the Act row to reveal hover actions, then click More.
  // Use the aria-label to target the inner row element where the
  // hover-action buttons live.
  const actRow = page.getByLabel('Act for Menu, draft')
  await actRow.hover()
  await actRow.getByRole('button', { name: 'More' }).click()

  // Menu should be visible with Rename / Status / Delete.
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Rename/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Status/i })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /Delete/i })).toBeVisible()

  // Click Status, then approved.
  await menu.getByRole('menuitem', { name: /Status/i }).click()
  await menu.getByRole('menuitem', { name: 'approved' }).click()

  // Menu closes; tree refreshes; Act now has status approved.
  await expect(menu).not.toBeVisible()
  await page.waitForTimeout(500)  // fetch round-trip
  const after = await admin.from('nodes').select('status').eq('id', act!.id).single()
  expect(after.data!.status).toBe('approved')

  // Take a screenshot of the post-mutation state.
  await page.screenshot({ path: 'test-results/tree_more_menu_post_status.png' })

  // Now open More on the ROOT row — Delete must be hidden.
  const rootRow = page.getByLabel('More Menu Doc, draft')
  await rootRow.hover()
  await rootRow.getByRole('button', { name: 'More' }).click()
  const rootMenu = page.locator('[role="menu"]')
  await expect(rootMenu).toBeVisible()
  await expect(rootMenu.getByRole('menuitem', { name: /Rename/i })).toBeVisible()
  await expect(rootMenu.getByRole('menuitem', { name: /Delete/i })).toHaveCount(0)

  await page.screenshot({ path: 'test-results/tree_more_menu_root.png' })

  // Cleanup
  await admin.from('projects').delete().eq('id', project!.id)
})
