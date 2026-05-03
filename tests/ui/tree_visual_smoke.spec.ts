// Visual smoke test for the NodeTree (T-4.2) — takes a screenshot of
// a document page with a small built tree so we can eyeball whether
// the tree renders, chevrons expand/collapse, and the AppShell layout
// frames it correctly.
//
// Not part of the Phase 2 Test Plan; a temporary local-only check.

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

test('NodeTree renders with a small tree', async ({ page }) => {
  // Build a small fixture document with a tree
  const orgId = await getUserOrgId(USERS.A.email)
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: 'Tree Visual Smoke' })
    .select('id')
    .single()

  const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id:      project!.id,
    p_organisation_id: orgId,
    p_name:            'Visual Smoke Doc',
    p_description:     null as unknown as string,
    p_document_type:   'novel',
    p_authors:         [],
  })
  const setup = rpc as { document: { id: string }; root_node: { id: string } }
  const docId = setup.document.id
  const rootId = setup.root_node.id

  const { data: act1 } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: rootId, node_category: 'structural', node_type: 'act',
      order: 1, depth: 1, layer_index: 1, name: 'Act 1', status: 'draft', version: 1,
    })
    .select('id')
    .single()
  const { data: act2 } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgId, project_id: project!.id, document_id: docId,
      parent_id: rootId, node_category: 'structural', node_type: 'act',
      order: 2, depth: 1, layer_index: 1, name: 'Act 2', status: 'approved', version: 1,
    })
    .select('id')
    .single()
  await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: docId,
    parent_id: act1!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'Chapter 1.1', status: 'draft', version: 1,
  })
  await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: docId,
    parent_id: act1!.id, node_category: 'structural', node_type: 'chapter',
    order: 2, depth: 2, layer_index: 2, name: 'Chapter 1.2', status: 'draft', version: 1,
  })
  await admin.from('nodes').insert({
    organisation_id: orgId, project_id: project!.id, document_id: docId,
    parent_id: act2!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: 'Chapter 2.1', status: 'in_review', version: 1,
  })

  await page.goto(`${BASE}/projects/${project!.id}/documents/${docId}`)
  await page.waitForLoadState('networkidle')

  // Capture screenshot regardless of the assertions below
  await page.screenshot({ path: 'test-results/tree_visual_smoke.png', fullPage: false })

  // Tree wrapper should be present (use first() because react-arborist's
  // internal element also carries role="tree").
  const tree = page.locator('[role="tree"]').first()
  await expect(tree).toBeAttached()

  // At least the root row's name should appear
  await expect(page.getByText('Visual Smoke Doc').first()).toBeVisible()

  // Cleanup
  await admin.from('projects').delete().eq('id', project!.id)
})
