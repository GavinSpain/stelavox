// Empty-state tests for §3.7 — hint visibility on a fresh document
// and disappearance after the first child is created.

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

test('Empty state: hint visible on fresh document; hidden after add-child', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'Empty State Smoke' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id, p_organisation_id: orgId,
    p_name: 'Empty Doc', p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Hint should be visible — root with no children, novel template
  // → first child layer is 'act'.
  const hint = page.getByTestId('empty-tree-hint')
  await expect(hint).toBeVisible()
  await expect(hint).toContainText(/your first act/i)

  await page.screenshot({ path: 'test-results/tree_empty_state_hint.png' })

  // Add a child via the + action; intercept the prompt.
  page.on('dialog', d => d.accept('Act One'))
  const rootRow = page.getByLabel('Empty Doc, draft')
  await rootRow.hover()
  await rootRow.getByRole('button', { name: 'Add child' }).click()

  // Wait for refresh; hint should disappear.
  await expect(page.getByLabel('Act One, draft')).toBeVisible({ timeout: 5000 })
  await expect(page.getByTestId('empty-tree-hint')).toHaveCount(0)

  await admin.from('projects').delete().eq('id', project!.id)
})
