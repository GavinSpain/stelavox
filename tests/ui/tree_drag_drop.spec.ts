// Interactive drag-and-drop test for the tree (T-5.1 + T-5.2).
// Exercises within-parent reorder + a layer-violating drop with
// toast surfacing.

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

test('Drag-and-drop: within-parent reorder updates DB', async ({ page }) => {
  // Setup: 3 acts under root in order 1, 2, 3.
  // Drag Act 3 above Act 1 → expect Act 3 at order 1.
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'DnD Reorder' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id, p_organisation_id: orgId,
    p_name: 'Reorder Doc', p_description: null as unknown as string,
    p_document_type: 'novel', p_authors: [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id
  const rootId = setup.root_node.id

  for (let i = 1; i <= 3; i++) {
    await admin
      .from('nodes')
      .insert({
        organisation_id: orgId, project_id: project!.id, document_id: docId,
        parent_id: rootId, node_category: 'structural', node_type: 'act',
        order: i, depth: 1, layer_index: 1, name: `Act ${i}`, status: 'draft', version: 1,
      })
  }

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Drag Act 3 above Act 1.
  const act3 = page.getByLabel('Act 3, draft')
  const act1 = page.getByLabel('Act 1, draft')
  await act3.dragTo(act1, { targetPosition: { x: 50, y: 0 } })

  // Wait for refetch.
  await page.waitForTimeout(800)

  // DB state: Act 3 should now be at order 1; Acts 1 and 2 shift to 2 and 3.
  const { data: rows } = await admin
    .from('nodes')
    .select('id, name, "order"')
    .eq('parent_id', rootId)
    .order('order')
  const byName = Object.fromEntries((rows ?? []).map(r => [r.name, r.order]))
  expect(byName['Act 3']).toBe(1)
  expect(byName['Act 1']).toBe(2)
  expect(byName['Act 2']).toBe(3)

  await admin.from('projects').delete().eq('id', project!.id)
})

test('Drag-and-drop: layer violation surfaces a rollback toast', async ({ page }) => {
  // Setup: a doc with root + 1 act + 1 chapter.
  // Drag the chapter onto the root → layer_violation (root admits acts).
  // Expect the API to reject; tree to roll back to its pre-move state;
  // toast to appear.
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'Drag Drop Smoke' })
    .select('id')
    .single()
  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            'Drag Drop Doc',
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
      order: 1, depth: 1, layer_index: 1, name: 'Act One', status: 'draft', version: 1,
    })
    .select('id')
    .single()
  const { data: chapter } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
      order: 1, depth: 2, layer_index: 2, name: 'Chapter One', status: 'draft', version: 1,
    })
    .select('id')
    .single()

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Drag the chapter onto the root row.
  const chRow = page.getByLabel('Chapter One, draft')
  const rootRow = page.getByLabel('Drag Drop Doc, draft')
  await chRow.dragTo(rootRow)

  // A toast should appear with the layer-violation message.
  const toast = page.locator('[data-testid="toast"][data-variant="error"]').first()
  await expect(toast).toBeVisible({ timeout: 4000 })
  await expect(toast).toContainText(/layer|belong/i)

  // DB: chapter's parent_id should be unchanged (still the act).
  const { data: after } = await admin
    .from('nodes')
    .select('parent_id, depth, layer_index, "order"')
    .eq('id', chapter!.id)
    .single()
  expect(after!.parent_id).toBe(act!.id)
  expect(after!.depth).toBe(2)
  expect(after!.layer_index).toBe(2)

  await page.screenshot({ path: 'test-results/tree_drag_drop_layer_violation.png' })

  await admin.from('projects').delete().eq('id', project!.id)
})
