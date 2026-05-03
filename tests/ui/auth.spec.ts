import { test, expect } from '@playwright/test'
import { USERS, APP_URL } from '../helpers/auth'
import { adminClient } from '../helpers/db'
import { pollForLink } from '../helpers/inbucket'

// TC-U-01: New user can sign up with email + password
// enable_confirmations=false so no email click needed; dashboard loads immediately
test('TC-U-01 new user sign up with password', async ({ page }) => {
  const admin = adminClient()
  const email = 'test-u01@example.com'
  const password = 'Test1234!Test1234!'

  // Cleanup before
  const { data: pre } = await admin.auth.admin.listUsers({ perPage: 200 })
  const prev = pre?.users.find(u => u.email === email)
  if (prev) await admin.auth.admin.deleteUser(prev.id)

  await page.goto(`${APP_URL}/signup`)
  await page.fill('input[type="text"]', 'Author Test01')
  await page.fill('input[type="email"]', email)
  await page.locator('input[type="password"]').nth(0).fill(password)
  await page.locator('input[type="password"]').nth(1).fill(password)
  await page.waitForTimeout(100)
  // Submit form
  await page.click('button[type="submit"]')
  // With enable_confirmations=false, should land at dashboard
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
  expect(page.url()).toBe(`${APP_URL}/dashboard`)

  // Verify DB side: org + membership created
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const newUser = (users?.users ?? []).find(u => u.email === email)
  expect(newUser).toBeTruthy()

  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id, role')
    .eq('user_id', newUser!.id)
    .single()
  expect(member?.role).toBe('owner')

  const { data: org } = await admin
    .from('organisations')
    .select('id')
    .eq('id', member!.organisation_id)
    .single()
  expect(org?.id).toBe(member!.organisation_id)

  // Cleanup
  await admin.auth.admin.deleteUser(newUser!.id)
})

// TC-U-02: New user sign up via magic link
test('TC-U-02 sign up via magic link', async ({ page }) => {
  const email = USERS.MAGIC.email
  const admin = adminClient()

  // Ensure clean state
  const { data: pre } = await admin.auth.admin.listUsers({ perPage: 200 })
  const prev = pre?.users.find(u => u.email === email)
  if (prev) await admin.auth.admin.deleteUser(prev.id)

  await page.goto(`${APP_URL}/login`)
  await page.click('button:has-text("magic link")')
  await page.fill('input[type="email"]', email)
  await page.click('button[type="submit"]')

  // Get magic link from Inbucket
  const link = await pollForLink(email, 15_000)
  expect(link).toBeTruthy()

  await page.goto(link!)
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
  expect(page.url()).toBe(`${APP_URL}/dashboard`)

  // DB: org + membership created
  const { data: users2 } = await admin.auth.admin.listUsers({ perPage: 200 })
  const magicUser = users2?.users.find(u => u.email === email)
  expect(magicUser).toBeTruthy()

  const { data: member } = await admin
    .from('organisation_members')
    .select('role')
    .eq('user_id', magicUser!.id)
    .single()
  expect(member?.role).toBe('owner')

  // Cleanup
  await admin.auth.admin.deleteUser(magicUser!.id)
})

// TC-U-03: Existing user can sign in
test('TC-U-03 existing user can sign in', async ({ page }) => {
  // Count orgs for User A before sign-in
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const userA = users?.users.find(u => u.email === USERS.A.email)
  expect(userA).toBeTruthy()

  const { count: orgsBefore } = await admin
    .from('organisations')
    .select('*', { count: 'exact', head: true })

  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', USERS.A.email)
  await page.fill('input[type="password"]', USERS.A.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 10_000 })
  expect(page.url()).toBe(`${APP_URL}/dashboard`)

  // No new orgs created
  const { count: orgsAfter } = await admin
    .from('organisations')
    .select('*', { count: 'exact', head: true })
  expect(orgsAfter).toBe(orgsBefore)
})

// TC-U-09: RLS blocks cross-user access at UI level
test('TC-U-09 RLS blocks cross-user access', async ({ browser }) => {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const userA = (users?.users ?? []).find(u => u.email === USERS.A.email)!
  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', userA.id)
    .single()

  // Create project + document as User A
  const { data: project } = await admin
    .from('projects')
    .insert({ organisation_id: member!.organisation_id, name: 'TC-U-09 A Project' })
    .select()
    .single()
  const { data: docResult } = await admin.rpc('create_document_with_layer_stack', {
    p_project_id: project!.id,
    p_organisation_id: member!.organisation_id,
    p_name: 'TC-U-09 Doc',
    p_description: null as unknown as string,
    p_document_type: 'novel',
    p_authors: [],
  })
  const doc = (docResult as { document: { id: string } }).document

  // Sign in as User B
  const ctxB = await browser.newContext({ storageState: USERS.B.storageState })
  const pageB = await ctxB.newPage()

  await pageB.goto(`${APP_URL}/projects/${project!.id}`)
  await pageB.waitForTimeout(500)
  await expect(pageB.locator('text=TC-U-09 A Project')).not.toBeVisible()

  await pageB.goto(`${APP_URL}/projects/${project!.id}/documents/${doc.id}`)
  await pageB.waitForTimeout(500)
  await expect(pageB.locator('text=TC-U-09 Doc')).not.toBeVisible()

  // User B dashboard shows zero projects (for B's own org, no A projects)
  await pageB.goto(`${APP_URL}/dashboard`)
  await expect(pageB.locator('text=TC-U-09 A Project')).not.toBeVisible()

  await ctxB.close()
  await admin.from('projects').delete().eq('id', project!.id)
})

// TC-U-10: User menu shows correct user
test('TC-U-10 user menu shows correct user', async ({ browser }) => {
  const ctxA = await browser.newContext({ storageState: USERS.A.storageState })
  const pageA = await ctxA.newPage()
  await pageA.goto(`${APP_URL}/dashboard`)
  await expect(pageA.locator(`text=${USERS.A.email}`)).toBeVisible()
  await ctxA.close()

  const ctxB = await browser.newContext({ storageState: USERS.B.storageState })
  const pageB = await ctxB.newPage()
  await pageB.goto(`${APP_URL}/dashboard`)
  await expect(pageB.locator(`text=${USERS.B.email}`)).toBeVisible()
  await expect(pageB.locator(`text=${USERS.A.email}`)).not.toBeVisible()
  await ctxB.close()
})

// ─── Tests requiring User A session ────────────────────────────────────────
// test.use() must be called at describe scope, not inside a test body.
test.describe('signed in as User A', () => {
  test.use({ storageState: USERS.A.storageState })

  // TC-U-06: Authenticated user can create a project
  test('TC-U-06 create a project', async ({ page }) => {
    const admin = adminClient()

    await page.goto(`${APP_URL}/dashboard`)
    await page.click('button:has-text("New project")')
    await page.fill('input[type="text"]', 'Untitled Project A1')
    await page.click('button:has-text("Create")')
    await page.waitForTimeout(500)

    // Project visible in list
    await expect(page.locator('text=Untitled Project A1')).toBeVisible()

    // Cleanup
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const userA = (users?.users ?? []).find(u => u.email === USERS.A.email)!
    const { data: members } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userA.id)
    const orgId = members?.[0]?.organisation_id
    if (orgId) {
      await admin.from('projects').delete().eq('organisation_id', orgId).eq('name', 'Untitled Project A1')
    }
  })

  // TC-U-07: Authenticated user can create a document
  test('TC-U-07 create a document', async ({ page }) => {
    const admin = adminClient()

    // Setup: create a project via API
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const userA = (users?.users ?? []).find(u => u.email === USERS.A.email)!
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userA.id)
      .single()
    const orgId = member!.organisation_id

    const { data: project } = await admin
      .from('projects')
      .insert({ organisation_id: orgId, name: 'TC-U-07 Project' })
      .select()
      .single()

    await page.goto(`${APP_URL}/projects/${project!.id}`)
    await page.click('button:has-text("New document")')
    await page.fill('input[type="text"]', 'My First Novel')
    // Select novel type if a selector is shown
    const typeSelect = page.locator('select, [role="combobox"]').first()
    if (await typeSelect.isVisible()) {
      await typeSelect.selectOption('novel')
    }
    await page.click('button:has-text("Create")')
    await page.waitForTimeout(500)
    await expect(page.locator('text=My First Novel')).toBeVisible()

    // Verify DB
    const { data: docs } = await admin
      .from('documents')
      .select('id, document_type, status, layer_stack_id')
      .eq('project_id', project!.id)
    expect(docs?.length).toBe(1)
    expect(docs![0].document_type).toBe('novel')
    expect(docs![0].status).toBe('active')
    expect(docs![0].layer_stack_id).toBeTruthy()

    const { data: ls } = await admin
      .from('layer_stacks')
      .select('is_template, document_id, layers')
      .eq('id', docs![0].layer_stack_id!)
      .single()
    expect(ls?.is_template).toBe(false)
    expect(ls?.document_id).toBe(docs![0].id)

    // Cleanup
    await admin.from('projects').delete().eq('id', project!.id)
  })

  // TC-U-08: Project deletion requires UI confirmation
  test('TC-U-08 project deletion confirmation', async ({ page }) => {
    const admin = adminClient()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const userA = (users?.users ?? []).find(u => u.email === USERS.A.email)!
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userA.id)
      .single()
    const { data: project } = await admin
      .from('projects')
      .insert({ organisation_id: member!.organisation_id, name: 'TC-U-08 Project' })
      .select()
      .single()

    await page.goto(`${APP_URL}/dashboard`)
    // Open context menu for the project
    await page.locator(`text=TC-U-08 Project`).first().hover()
    await page.click('[data-testid="project-menu"], button[aria-label*="menu"]')

    // Click delete — expect confirmation dialog
    await page.click('text=Delete')
    await expect(page.locator('[role="dialog"]')).toBeVisible()

    // Cancel — project survives
    await page.click('button:has-text("Cancel")')
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
    await expect(page.locator('text=TC-U-08 Project')).toBeVisible()

    // Delete again and confirm
    await page.click('[data-testid="project-menu"], button[aria-label*="menu"]')
    await page.click('text=Delete')
    await page.click('button:has-text("Delete")')
    await expect(page.locator('[role="dialog"]')).not.toBeVisible()
    await expect(page.locator('text=TC-U-08 Project')).not.toBeVisible()

    // DB check
    const { data: dead } = await admin.from('projects').select('id').eq('id', project!.id).maybeSingle()
    expect(dead).toBeNull()
  })

  // TC-U-11: Document archive (status transition)
  test('TC-U-11 document archive', async ({ page }) => {
    const admin = adminClient()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const userA = (users?.users ?? []).find(u => u.email === USERS.A.email)!
    const { data: member } = await admin
      .from('organisation_members')
      .select('organisation_id')
      .eq('user_id', userA.id)
      .single()
    const { data: project } = await admin
      .from('projects')
      .insert({ organisation_id: member!.organisation_id, name: 'TC-U-11 Project' })
      .select()
      .single()
    const { data: docResult } = await admin.rpc('create_document_with_layer_stack', {
      p_project_id: project!.id,
      p_organisation_id: member!.organisation_id,
      p_name: 'TC-U-11 Doc',
      p_description: null as unknown as string,
      p_document_type: 'novel',
      p_authors: [],
    })
    const doc = (docResult as { document: { id: string } }).document

    await page.goto(`${APP_URL}/projects/${project!.id}`)
    // Open document menu and archive
    await page.locator('text=TC-U-11 Doc').hover()
    await page.click('[data-testid="document-menu"], button[aria-label*="menu"]')
    await page.click('text=Archive')
    await page.waitForTimeout(500)

    // Document no longer visible in active list
    await expect(page.locator('text=TC-U-11 Doc')).not.toBeVisible()

    // DB: status is archived
    const { data: updated } = await admin
      .from('documents')
      .select('status')
      .eq('id', doc.id)
      .single()
    expect(updated?.status).toBe('archived')

    // Cleanup
    await admin.from('projects').delete().eq('id', project!.id)
  })

  // TC-U-12: Session persists across page reload
  test('TC-U-12 session persists across reload', async ({ page }) => {
    await page.goto(`${APP_URL}/dashboard`)
    await page.reload()
    await expect(page.locator(`text=${USERS.A.email}`)).toBeVisible()
    expect(page.url()).toBe(`${APP_URL}/dashboard`)
  })

  // TC-U-04: Existing user can sign out — run last so sign-out doesn't invalidate
  // the shared storageState used by TC-U-06 through TC-U-12.
  test('TC-U-04 user can sign out', async ({ page }) => {
    await page.goto(`${APP_URL}/dashboard`)
    // Click sign out
    await page.click('button:has-text("Sign out")')
    await page.waitForURL(`${APP_URL}/login`, { timeout: 10_000 })
    expect(page.url()).toContain('/login')

    // Reload dashboard → redirected to login
    await page.goto(`${APP_URL}/dashboard`)
    await page.waitForURL(/\/login/, { timeout: 5_000 })
    expect(page.url()).toContain('/login')
  })
})

// TC-U-05: Password reset flow — run after all storageState tests because
// changing User A's password revokes all their server-side sessions.
test('TC-U-05 password reset flow', async ({ page }) => {
  const email = USERS.A.email
  const newPassword = 'NewPass9999!NewPass'

  await page.goto(`${APP_URL}/forgot-password`)
  await page.fill('input[type="email"]', email)
  await page.click('button[type="submit"]')

  const link = await pollForLink(email, 15_000)
  expect(link).toBeTruthy()

  // The reset link is handled by Supabase auth callback, which sets a session
  // then redirects to /reset-password
  await page.goto(link!)
  await page.waitForURL(/reset-password/, { timeout: 10_000 })

  // Fill new password
  const inputs = page.locator('input[type="password"]')
  await inputs.nth(0).fill(newPassword)
  await inputs.nth(1).fill(newPassword)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 10_000 })

  // Sign out and verify new password works
  await page.click('button:has-text("Sign out")')
  await page.waitForURL(/\/login/)
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', newPassword)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 10_000 })

  // Restore original password for subsequent test runs
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const userA = (users?.users ?? []).find(u => u.email === email)!
  await admin.auth.admin.updateUserById(userA.id, { password: USERS.A.password })
})
