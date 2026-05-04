// UI checkpoint tests for the Phase 4 Context tab / ContextLinker / Picker.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-U-08, TC-U-09, TC-U-11, TC-U-13,
//                                          TC-V-04, TC-V-05

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import { adminClient } from '../helpers/db'

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

async function setupTree(orgId: string, suffix: string) {
  const { data: project } = await adminClient()
    .from('projects')
    .insert({ organisation_id: orgId, name: `TC-U-${suffix}-project` })
    .select()
    .single()
  const { data: rpc } = await adminClient().rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            `TC-U-${suffix}-doc`,
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpc as { document: { id: string; root_node_id: string }; root_node: { id: string } }

  // One Elena (project-scoped character) for the linker tests.
  const { data: elena } = await adminClient().from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, parent_id: null,
    node_category: 'context', node_type: 'character',
    scope: 'project', name: 'Elena',
    status: 'draft', version: 1, metadata: {} as never,
  }).select().single()

  return { project: project!, document: setup.document, rootNode: setup.root_node, elena: elena! }
}

test.use({ storageState: USERS.A.storageState })

test('TC-U-08 Context tab on root with one direct link shows the linked context', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document, rootNode, elena } = await setupTree(orgId, 'U-08')

  // Seed a direct link via service role.
  await adminClient().from('node_context_links').insert({
    organisation_id: orgId,
    source_node_id:  rootNode.id,
    target_node_id:  elena.id,
    link_type:       'structural_to_context',
  })

  await page.goto(`/projects/${project.id}/documents/${document.id}`)

  // Click the root node in the tree (the document's root — the Book).
  await page.getByRole('treeitem').first().click()

  // Open Context tab.
  await page.getByRole('tab', { name: /Context/i }).click()

  // Direct linked Elena visible in the linker.
  await expect(page.getByText('Linked context')).toBeVisible()
  await expect(page.getByText('Elena')).toBeVisible({ timeout: 5000 })
})

test('TC-U-09 + TC-U-11 [+ Link context node] opens NodePicker; selection links', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document } = await setupTree(orgId, 'U-09-11')

  await page.goto(`/projects/${project.id}/documents/${document.id}`)
  await page.getByRole('treeitem').first().click()
  await page.getByRole('tab', { name: /Context/i }).click()

  // [+ Link context node]
  await page.getByRole('button', { name: /Link context node/i }).click()

  // Picker opens — shows Elena under Characters.
  const picker = page.getByRole('dialog')
  await expect(picker).toBeVisible()
  await expect(picker.getByText(/Characters/i).first()).toBeVisible()
  await expect(picker.getByRole('option', { name: /Elena/i })).toBeVisible()

  // Click Elena.
  await picker.getByRole('option', { name: /Elena/i }).click()

  // Picker closes; Elena now appears in the direct list.
  await expect(picker).not.toBeVisible()
  await expect(page.getByText('Linked context')).toBeVisible()
  // The direct list contains Elena (after the optimistic insert).
  await expect(page.locator('text=Elena').first()).toBeVisible({ timeout: 5000 })
})
