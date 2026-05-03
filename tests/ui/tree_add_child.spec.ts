// Interactive smoke test for Add-child action (T-4.7).
// Hovers a row, clicks the + button, types a name into the prompt,
// asserts the new node appears in the tree.

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

test('Add-child: + button creates a child node and refreshes the tree', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'Add Child Smoke' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            'Add Child Doc',
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Pre-stub the prompt so the click resolves without manual input.
  page.on('dialog', dialog => dialog.accept('Act One'))

  // Click the + on the root row (no acts yet).
  const rootRow = page.getByLabel('Add Child Doc, draft')
  await rootRow.hover()
  await rootRow.getByRole('button', { name: 'Add child' }).click()

  // Wait for the tree to refresh and the new act to appear.
  await expect(page.getByLabel('Act One, draft')).toBeVisible({ timeout: 5000 })

  await page.screenshot({ path: 'test-results/tree_add_child.png' })

  // DB verification
  const { data: rows } = await admin
    .from('nodes')
    .select('node_type, name, parent_id')
    .eq('document_id', docId)
    .eq('node_type', 'act')
  expect(rows).toHaveLength(1)
  expect(rows![0].name).toBe('Act One')

  await admin.from('projects').delete().eq('id', project!.id)
})
