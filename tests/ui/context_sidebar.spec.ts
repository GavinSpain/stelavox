// UI checkpoint tests for the Phase 4 Sidebar context library and the
// ContextCreateModal flow.
// Spec: stelavox_phase4_test_plan_v1_0.md TC-U-01..TC-U-07, TC-V-01..03,
//                                          TC-AX-01, TC-M-04
//       stelavox_phase4_build_checklist_v1_0.md §3.4, §3.5, §3.7
//
// Mirrors tests/ui/tree_*.spec.ts patterns: Playwright headed browser
// with stored auth state, real DB via service-role for setup.

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

async function setupProjectAndDoc(orgId: string, suffix: string) {
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
  return { project: project!, document: setup.document, rootNode: setup.root_node }
}

test.use({ storageState: USERS.A.storageState })

test('TC-U-01 Sidebar Context library renders six type sections', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document } = await setupProjectAndDoc(orgId, 'U-01')

  await page.goto(`/projects/${project.id}/documents/${document.id}`)

  // The six type labels per Component Spec §2.3 + Phase 4 build checklist.
  for (const label of ['Characters', 'Locations', 'Organisations', 'Themes', 'Plot Threads', 'Worlds']) {
    await expect(page.getByRole('button', { name: new RegExp(label, 'i') })).toBeVisible()
  }
})

test('TC-U-05 Sidebar [+] opens modal; submit creates a project-scoped character', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document } = await setupProjectAndDoc(orgId, 'U-05')

  await page.goto(`/projects/${project.id}/documents/${document.id}`)

  // Hover the Characters section header to reveal the + button. Since
  // hover affordances rely on CSS, we just locate the button by its
  // aria-label even when its opacity is animating in. exact:true
  // disambiguates against the parent header's accessible-name fold-in
  // (the header has role=button + aria-controls and inherits the
  // child's text content).
  await page.getByRole('button', { name: 'Create new character', exact: true }).click({ force: true })

  // Modal opens with the title "New Character".
  await expect(page.getByRole('dialog')).toContainText(/New Character/i)

  // Fill name + create. The modal's Field component uses sibling
  // <label>/<input> rather than htmlFor, so getByLabel doesn't match;
  // locate via the first textbox in the dialog (which is the autofocused
  // Name input).
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill('Elena')
  await dialog.getByRole('button', { name: /^Create$/ }).click()

  // Sidebar refreshes — the Characters section count goes from (0) to (1).
  // Sections are collapsed by default; the count is the visible signal of
  // success without needing to expand. (Expanding would also work but
  // adds an unnecessary click step.)
  await expect(page.getByRole('button', { name: /Characters\(1\)/i })).toBeVisible({ timeout: 5000 })
})

test('TC-AX-01 Sidebar section headers have role=button and aria-expanded', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document } = await setupProjectAndDoc(orgId, 'AX-01')

  await page.goto(`/projects/${project.id}/documents/${document.id}`)

  const charactersHeader = page.getByRole('button', { name: /Characters/i }).first()
  await expect(charactersHeader).toHaveAttribute('aria-expanded', 'false')
  await charactersHeader.click()
  await expect(charactersHeader).toHaveAttribute('aria-expanded', 'true')
})

test('TC-V-01 Sidebar type icons render at 14px', async ({ page }) => {
  const orgId = await getUserOrgId(USERS.A.email)
  const { project, document } = await setupProjectAndDoc(orgId, 'V-01')

  // Seed one character so a row renders with an icon.
  await adminClient().from('nodes').insert({
    organisation_id: orgId, project_id: project.id, parent_id: null,
    node_category: 'context', node_type: 'character',
    scope: 'project', name: 'Elena',
    status: 'draft', version: 1, metadata: {} as never,
  })

  await page.goto(`/projects/${project.id}/documents/${document.id}`)

  // Expand Characters.
  await page.getByRole('button', { name: /Characters/i }).first().click()

  // Find Elena's row and inspect the icon SVG.
  const row = page.locator('button.sidebar-context-row', { hasText: 'Elena' })
  await expect(row).toBeVisible({ timeout: 5000 })
  const icon = row.locator('svg').first()
  await expect(icon).toHaveAttribute('width', '14')
  await expect(icon).toHaveAttribute('height', '14')
})
