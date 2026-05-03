// Interactive smoke tests for the detail panel (§3.6).
//   - Selection populates the right slot with a NodeDetailPanel.
//   - TC-U-04: rename via the detail panel.
//   - TC-U-10: status change via the status select.

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

test.describe('Detail panel', () => {
  let orgId: string
  let projectId: string
  let docId: string
  let actId: string

  test.beforeAll(async () => {
    orgId = await getUserOrgId(USERS.A.email)
    const admin = adminClient()
    const { data: project } = await admin
      .from('projects')
      .insert({ organisation_id: orgId, name: 'Detail Panel Smoke' })
      .select('id')
      .single()
    projectId = project!.id
    const { data: rpc } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: projectId, p_organisation_id: orgId,
      p_name: 'Detail Doc', p_description: null as unknown as string,
      p_document_type: 'novel', p_authors: [],
    })
    const setup = rpc as { document: { id: string }; root_node: { id: string } }
    docId = setup.document.id
    const { data: act } = await admin
      .from('nodes')
      .insert({
        organisation_id: orgId, project_id: projectId, document_id: docId,
        parent_id: setup.root_node.id, node_category: 'structural', node_type: 'act',
        order: 1, depth: 1, layer_index: 1, name: 'Original Act Name', status: 'draft', version: 1,
      })
      .select('id').single()
    actId = act!.id
  })

  test.afterAll(async () => {
    await adminClient().from('projects').delete().eq('id', projectId)
  })

  test('Selecting a row opens the detail panel; placeholder cleared', async ({ page }) => {
    await page.goto(`${BASE}/projects/${projectId}/documents/${docId}`)
    await page.waitForLoadState('networkidle')

    // Right slot starts as the muted "Node detail" placeholder.
    const placeholder = page.getByText('Node detail').first()
    await expect(placeholder).toBeVisible()

    // Click the act row to select it.
    await page.getByLabel('Original Act Name, draft').click()

    // Detail panel populates: heading + tab strip should appear.
    await expect(page.getByTestId('node-name-heading')).toBeVisible({ timeout: 4000 })
    await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible()
    await page.screenshot({ path: 'test-results/tree_detail_panel_open.png' })
  })

  test('TC-U-04 rename via detail panel', async ({ page }) => {
    await page.goto(`${BASE}/projects/${projectId}/documents/${docId}`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel(/Original Act Name|Renamed Via Panel/).click()
    const heading = page.getByTestId('node-name-heading')
    await expect(heading).toBeVisible()

    await heading.click()
    const input = page.getByLabel('Rename node')
    await input.fill('Renamed Via Panel')
    await input.press('Enter')

    // DB row updated
    await page.waitForTimeout(500)
    const { data: row } = await adminClient()
      .from('nodes')
      .select('name, version')
      .eq('id', actId)
      .single()
    expect(row!.name).toBe('Renamed Via Panel')
    // Rename is a non-content change — version should NOT bump.
    expect(row!.version).toBe(1)
  })

  test('TC-U-10 status change via detail panel select', async ({ page }) => {
    // Reset the act's name for stable selectors
    await adminClient().from('nodes').update({ name: 'Status Test Act', status: 'draft' }).eq('id', actId)

    await page.goto(`${BASE}/projects/${projectId}/documents/${docId}`)
    await page.waitForLoadState('networkidle')

    await page.getByLabel('Status Test Act, draft').click()
    await expect(page.getByTestId('node-name-heading')).toBeVisible()

    await page.getByTestId('status-select').selectOption('approved')

    await page.waitForTimeout(500)
    const { data: row } = await adminClient()
      .from('nodes')
      .select('status')
      .eq('id', actId)
      .single()
    expect(row!.status).toBe('approved')
  })
})
