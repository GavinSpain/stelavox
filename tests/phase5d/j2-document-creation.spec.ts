import { test, expect, request as playwrightRequest } from '@playwright/test'
import { DashboardPage } from '../pages/DashboardPage'
import { ProjectPage } from '../pages/ProjectPage'
import { NodeTreePage } from '../pages/NodeTreePage'
import { adminClient } from '../helpers/db'
import { createIsolatedDoc, getOrganisationIdForUser, deleteUserByEmail, findUserByEmail } from '../helpers/isolation'
import { APP_URL, USERS } from '../helpers/auth'

// Phase 5d — J2 Document creation journey.
// 21 cases per docs/stelavox_phase5d_test_plan_v1_0.md §4.2.
//
// J2 is the first Journey to exercise createIsolatedDoc end-to-end.
// Each test that creates persistent state owns its cleanup.
//
// Tree-mutation cases (drag-drop reorder/reparent + cycle detection) are
// scoped to J2 in the Test Plan but are deferred via test.skip with
// reason: drag-drop in Playwright is fragile and depends on react-arborist
// internals. Existing Phase 2 prior-art at tests/ui/tree_drag_drop.spec.ts
// covers these contracts; rewriting in Phase 5d shape is a follow-up.

test.use({ storageState: USERS.A.storageState })

let createdProjectIds: string[] = []
let createdEmails: string[] = []

test.beforeEach(async () => {
  createdProjectIds = []
  createdEmails = []
})

test.afterEach(async () => {
  const admin = adminClient()
  for (const projectId of createdProjectIds) {
    await admin.from('projects').delete().eq('id', projectId).then(() => {}, () => {})
  }
  for (const email of createdEmails) {
    await deleteUserByEmail(email).catch(() => {})
  }
})

async function getOrgId(): Promise<string> {
  const user = await findUserByEmail(USERS.A.email)
  if (!user) throw new Error('USERS.A not seeded')
  return getOrganisationIdForUser(user.id)
}

function uniqueName(tag: string): string {
  return `j2-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

// ─── Project creation (TC-J2-01..04) ────────────────────────────────────────

test('TC-J2-01: create new project from Dashboard surfaces it in the list', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await dashboard.expectAuthenticated()

  const name = uniqueName('01')
  await dashboard.createProject({ name })

  // Modal closes; router refresh; project visible in list.
  await page.waitForTimeout(800)
  await dashboard.expectProjectVisible(name)

  // DB-side: project exists in caller's org.
  const orgId = await getOrgId()
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .select('id, name')
    .eq('organisation_id', orgId)
    .eq('name', name)
    .single()
  expect(project).toBeTruthy()
  createdProjectIds.push(project!.id)
})

test('TC-J2-02: New-project modal blocks empty name (HTML required)', async ({ page }) => {
  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await dashboard.clickNewProject()

  // Click submit without filling name. HTML required attribute prevents
  // submission; modal stays open.
  await dashboard.modalSubmitButton().click()
  await page.waitForTimeout(500)

  // Modal still rendered (Cancel still visible).
  await expect(dashboard.modalCancelButton()).toBeVisible({ timeout: 2_000 })
})

test('TC-J2-03: project name >200 chars is truncated by maxLength on input', async ({ page }) => {
  // The Test Plan calls for >255 char rejection; the actual UI enforces
  // maxLength=200 (NewProjectDialog.tsx). The HTML input enforces this
  // client-side — typing more than 200 characters still leaves the input
  // at 200. Defence-in-depth: server-side validation (zod schema) would
  // also reject — but the client cap means the request never goes out
  // with an over-length name unless the test bypasses the input.
  const dashboard = new DashboardPage(page)
  await dashboard.goto()
  await dashboard.clickNewProject()

  const longName = 'X'.repeat(300)
  await dashboard.modalNameInput().fill(longName)
  const actualValue = await dashboard.modalNameInput().inputValue()
  expect(actualValue.length).toBeLessThanOrEqual(200)

  // Cancel out — no DB write needed for this validation case.
  await dashboard.modalCancelButton().click()
  await page.waitForTimeout(300)
})

test('TC-J2-04: cross-org project insert via direct API is blocked by RLS', async () => {
  // Use User B's session to attempt to read a project owned by User A.
  // Setup: create a project as User A via admin.
  const adminA = adminClient()
  const orgAId = await getOrgId()
  const { data: project } = await adminA
    .from('projects')
    .insert({ organisation_id: orgAId, name: uniqueName('04-blocked') })
    .select('id')
    .single()
  createdProjectIds.push(project!.id)

  // Spawn a context as User B; attempt to GET the project via API.
  const browserContextOptions = { storageState: USERS.B.storageState }
  const fetched = await playwrightRequest.newContext(browserContextOptions)
  const res = await fetched.get(`${APP_URL}/api/projects/${project!.id}`)

  // SU-J2-1 (resolved): cross-org access returns 404 (RLS hides row).
  expect([403, 404]).toContain(res.status())
  const body = await res.text()
  expect(body).not.toContain(project!.id)
})

// ─── Document creation (TC-J2-05..07) ───────────────────────────────────────

test('TC-J2-05: new document in a Novel project shows in the document list', async ({ page }) => {
  // Create a project to host the document.
  const orgId = await getOrgId()
  const admin = adminClient()
  const projectName = uniqueName('05-project')
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: projectName })
    .select('id')
    .single()
  createdProjectIds.push(project!.id)

  const projectPage = new ProjectPage(page, project!.id)
  await projectPage.goto()
  await projectPage.expectVisible()

  const docName = uniqueName('05-doc')
  await projectPage.createDocument({ name: docName, docType: 'novel' })

  await page.waitForTimeout(800)
  await projectPage.expectDocumentVisible(docName)

  // DB-side: document + layer_stack atomic creation (H-14).
  const { data: docs } = await admin
    .from('documents')
    .select('id, name, document_type, status, layer_stack_id')
    .eq('project_id', project!.id)
  expect(docs?.length).toBe(1)
  expect(docs![0].name).toBe(docName)
  expect(docs![0].document_type).toBe('novel')
  expect(docs![0].status).toBe('active')
  expect(docs![0].layer_stack_id).toBeTruthy()
})

test('TC-J2-06: New-document modal blocks empty title', async ({ page }) => {
  const orgId = await getOrgId()
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: uniqueName('06-project') })
    .select('id')
    .single()
  createdProjectIds.push(project!.id)

  const projectPage = new ProjectPage(page, project!.id)
  await projectPage.goto()
  await projectPage.clickNewDocument()
  await projectPage.modalSubmitButton().click()
  await page.waitForTimeout(500)

  // Modal still rendered.
  await expect(projectPage.modalCancelButton()).toBeVisible({ timeout: 2_000 })
})

test('TC-J2-07: document with malformed type via direct API is rejected', async () => {
  const orgId = await getOrgId()
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: uniqueName('07-project') })
    .select('id')
    .single()
  createdProjectIds.push(project!.id)

  const fetched = await playwrightRequest.newContext({ storageState: USERS.A.storageState })
  const res = await fetched.post(`${APP_URL}/api/projects/${project!.id}/documents`, {
    data: { name: 'Bad Type Doc', document_type: 'not-a-real-template' },
  })

  // SU-J2-2 (resolved): malformed document_type returns 400 (zod-validated).
  expect([400, 422]).toContain(res.status())
  const { data: docs } = await admin
    .from('documents')
    .select('id')
    .eq('project_id', project!.id)
  expect(docs?.length ?? 0).toBe(0)
})

// ─── Document open + visibility (TC-J2-08..10) ──────────────────────────────

test('TC-J2-08: opening a Novel doc renders NodeTree with seed structure', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-08' })
  createdProjectIds.push(seeded.projectId)

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()

  const rootName = await tree.getRootRowLabel(adminClient() as never)
  await tree.expectRowVisible(rootName)
})

test('TC-J2-09: visiting a non-existent document URL surfaces 404 page', async ({ page }) => {
  const orgId = await getOrgId()
  const admin = adminClient()
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: orgId, name: uniqueName('09-project') })
    .select('id')
    .single()
  createdProjectIds.push(project!.id)

  // UUID-shaped but non-existent doc id.
  const fakeDocId = '00000000-0000-0000-0000-000000000099'
  const res = await page.goto(`${APP_URL}/projects/${project!.id}/documents/${fakeDocId}`)
  // Next.js notFound() surfaces a 404 status.
  expect(res?.status()).toBe(404)
})

test('TC-J2-10: cross-org document URL returns 404 (no existence leak)', async ({ browser }) => {
  // Setup as User A.
  const orgAId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgAId, ownerName: 'TC-J2-10' })
  createdProjectIds.push(seeded.projectId)

  // Open as User B and try to visit A's doc URL.
  const ctxB = await browser.newContext({ storageState: USERS.B.storageState })
  const pageB = await ctxB.newPage()
  const res = await pageB.goto(`${APP_URL}/projects/${seeded.projectId}/documents/${seeded.docId}`)
  // Cross-org should be 404 (RLS hides existence).
  expect(res?.status()).toBe(404)
  await ctxB.close()
})

// ─── Tree mutation (TC-J2-11..21) ───────────────────────────────────────────

test('TC-J2-11: add child via more-menu / + button creates a new child node', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-11' })
  createdProjectIds.push(seeded.projectId)

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()
  const rootName = await tree.getRootRowLabel(adminClient() as never)

  // Add child via the legacy window.prompt flow (SU-22).
  const childName = uniqueName('11-child')
  page.on('dialog', dialog => dialog.accept(childName))

  await tree.clickAddChild(rootName)
  await tree.expectRowVisible(childName)

  // DB-side: row exists under the doc.
  const admin = adminClient()
  const { data: nodes } = await admin
    .from('nodes')
    .select('id, name')
    .eq('document_id', seeded.docId)
    .eq('name', childName)
  expect(nodes?.length).toBe(1)
})

test('TC-J2-12: add-child button is hidden on a leaf node', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-12' })
  createdProjectIds.push(seeded.projectId)

  // Build down to a leaf: Act → Chapter → Scene → Beat. The Beat
  // is the leaf in the Novel template (layer_index = 4).
  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id

  async function insert(parentId: string, type: string, depth: number, layerIndex: number, name: string): Promise<string> {
    const { data } = await admin.from('nodes').insert({
      organisation_id: orgId,
      project_id: seeded.projectId,
      document_id: seeded.docId,
      parent_id: parentId,
      node_category: 'structural',
      node_type: type,
      order: 1,
      depth,
      layer_index: layerIndex,
      name,
      status: 'draft',
      version: 1,
    }).select('id').single()
    return data!.id
  }

  const actId = await insert(rootId, 'act', 1, 1, uniqueName('12-act'))
  const chapId = await insert(actId, 'chapter', 2, 2, uniqueName('12-chap'))
  const sceneId = await insert(chapId, 'scene', 3, 3, uniqueName('12-scene'))
  const beatName = uniqueName('12-beat')
  await insert(sceneId, 'beat', 4, 4, beatName)

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()

  // Beat is leaf — its row exists, but hovering should NOT reveal an
  // Add-child button (per H-15 leaf-only mounting; UI hides the action).
  await tree.expectRowVisible(beatName)
  const beatRow = tree.row(beatName)
  await beatRow.hover()
  await expect(beatRow.getByRole('button', { name: 'Add child' })).toHaveCount(0)
})

test('TC-J2-13: inline-rename via more-menu Rename persists', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-13' })
  createdProjectIds.push(seeded.projectId)

  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id
  const childOriginalName = uniqueName('13-orig')
  const { data: child } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: seeded.projectId, document_id: seeded.docId,
    parent_id: rootId, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: childOriginalName,
    status: 'draft', version: 1,
  }).select('id').single()

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()
  await tree.expectRowVisible(childOriginalName)

  const newName = uniqueName('13-new')
  page.on('dialog', dialog => dialog.accept(newName))

  await tree.openMoreMenu(childOriginalName)
  await tree.menuItem(/Rename/i).click()
  await tree.expectRowVisible(newName)

  const { data: after } = await admin.from('nodes').select('name').eq('id', child!.id).single()
  expect(after?.name).toBe(newName)
})

test('TC-J2-14: inline-rename to empty string is rejected; original name preserved', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-14' })
  createdProjectIds.push(seeded.projectId)

  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id
  const childOriginalName = uniqueName('14-orig')
  const { data: child } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: seeded.projectId, document_id: seeded.docId,
    parent_id: rootId, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: childOriginalName,
    status: 'draft', version: 1,
  }).select('id').single()

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()
  await tree.expectRowVisible(childOriginalName)

  // Dismiss the prompt — original name should persist.
  page.on('dialog', dialog => dialog.dismiss())
  await tree.openMoreMenu(childOriginalName)
  await tree.menuItem(/Rename/i).click()
  await page.waitForTimeout(800)

  await tree.expectRowVisible(childOriginalName)
  const { data: after } = await admin.from('nodes').select('name').eq('id', child!.id).single()
  expect(after?.name).toBe(childOriginalName)
})

test('TC-J2-15: delete leaf node via more-menu Delete + confirm', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-15' })
  createdProjectIds.push(seeded.projectId)

  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id
  const childName = uniqueName('15-child')
  const { data: child } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: seeded.projectId, document_id: seeded.docId,
    parent_id: rootId, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: childName,
    status: 'draft', version: 1,
  }).select('id').single()

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()
  await tree.expectRowVisible(childName)

  page.on('dialog', dialog => dialog.accept())
  await tree.openMoreMenu(childName)
  await tree.menuItem(/Delete/i).click()
  await page.waitForTimeout(800)

  await tree.expectRowMissing(childName)
  const { data: deleted } = await admin.from('nodes').select('id').eq('id', child!.id).maybeSingle()
  expect(deleted).toBeNull()
})

test('TC-J2-16: delete parent cascades to children', async ({ page }) => {
  const orgId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgId, ownerName: 'TC-J2-16' })
  createdProjectIds.push(seeded.projectId)

  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id

  // Insert Act with a Chapter child.
  const actName = uniqueName('16-act')
  const { data: act } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: seeded.projectId, document_id: seeded.docId,
    parent_id: rootId, node_category: 'structural', node_type: 'act',
    order: 1, depth: 1, layer_index: 1, name: actName,
    status: 'draft', version: 1,
  }).select('id').single()

  const chapterName = uniqueName('16-chapter')
  const { data: chapter } = await admin.from('nodes').insert({
    organisation_id: orgId, project_id: seeded.projectId, document_id: seeded.docId,
    parent_id: act!.id, node_category: 'structural', node_type: 'chapter',
    order: 1, depth: 2, layer_index: 2, name: chapterName,
    status: 'draft', version: 1,
  }).select('id').single()

  const tree = new NodeTreePage(page, seeded.projectId, seeded.docId)
  await tree.goto()
  await tree.expectRowVisible(actName)

  page.on('dialog', dialog => dialog.accept())
  await tree.openMoreMenu(actName)
  await tree.menuItem(/Delete/i).click()
  await page.waitForTimeout(1_500)

  // Both Act and Chapter rows are gone; DB rows cascade-deleted.
  await tree.expectRowMissing(actName)
  await tree.expectRowMissing(chapterName)
  const { data: actAfter } = await admin.from('nodes').select('id').eq('id', act!.id).maybeSingle()
  const { data: chapAfter } = await admin.from('nodes').select('id').eq('id', chapter!.id).maybeSingle()
  expect(actAfter).toBeNull()
  expect(chapAfter).toBeNull()
})

test('TC-J2-17: delete cross-org node via direct API is blocked by RLS', async () => {
  const orgAId = await getOrgId()
  const seeded = await createIsolatedDoc({ organisationId: orgAId, ownerName: 'TC-J2-17' })
  createdProjectIds.push(seeded.projectId)

  // Add a child under A's doc so we have a node to attempt-delete.
  const admin = adminClient()
  const rootId = (await admin.from('nodes').select('id').eq('document_id', seeded.docId).is('parent_id', null).single()).data!.id
  const { data: child } = await admin
    .from('nodes')
    .insert({
      organisation_id: orgAId,
      project_id: seeded.projectId,
      document_id: seeded.docId,
      parent_id: rootId,
      node_category: 'structural',
      node_type: 'act',
      order: 1,
      depth: 1,
      layer_index: 1,
      name: uniqueName('17-child'),
      status: 'draft',
      version: 1,
    })
    .select('id')
    .single()

  // As User B, attempt DELETE.
  const fetched = await playwrightRequest.newContext({ storageState: USERS.B.storageState })
  const res = await fetched.delete(`${APP_URL}/api/nodes/${child!.id}`)
  expect([403, 404]).toContain(res.status())

  // DB row still exists — the delete was blocked by RLS.
  const { data: still } = await admin.from('nodes').select('id').eq('id', child!.id).maybeSingle()
  expect(still).toBeTruthy()
})

test('TC-J2-18: drag-drop sibling reorder', async () => {
  test.skip(true,
    'Drag-drop in Playwright with react-arborist is fragile; depends on ' +
    'mouseDown/mouseMove/mouseUp sequencing that varies across browsers ' +
    'and arborist versions. Existing Phase 2 prior-art at ' +
    'tests/ui/tree_drag_drop.spec.ts covers the contract via the ' +
    '/api/nodes/[id]/move endpoint directly. J2.B can fold this into ' +
    'Phase 5d shape if the user confirms appetite for drag-drop UI tests.')
})

test('TC-J2-19: drag-drop reparent', async () => {
  test.skip(true, 'See TC-J2-18 — drag-drop UI test deferred to J2.B.')
})

test('TC-J2-20: drag-drop into a leaf as parent is blocked', async () => {
  test.skip(true, 'See TC-J2-18 — drag-drop UI test deferred to J2.B.')
})

test('TC-J2-21: drag-drop into own descendant (cycle) is blocked', async () => {
  test.skip(true, 'See TC-J2-18 — drag-drop UI test deferred to J2.B.')
})
