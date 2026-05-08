import { test, expect } from '@playwright/test'
import { LoginPage } from '../pages/LoginPage'
import { SignupPage } from '../pages/SignupPage'
import { ForgotPasswordPage } from '../pages/ForgotPasswordPage'
import { ResetPasswordPage } from '../pages/ResetPasswordPage'
import { EmailVerificationPage } from '../pages/EmailVerificationPage'
import { DashboardPage } from '../pages/DashboardPage'
import { adminClient } from '../helpers/db'
import { deleteUserByEmail, findUserByEmail } from '../helpers/isolation'
import { APP_URL, USERS } from '../helpers/auth'
import { pollForLink } from '../helpers/inbucket'

// Phase 5d — J1 Onboarding journey.
// 14 cases per docs/stelavox_phase5d_test_plan_v1_0.md §4.1.
// All tests own their own fresh user; cleanup runs in afterEach.
//
// Local note: supabase/config.toml has `enable_confirmations = false` so
// signup redirects directly to /dashboard without an email click. Tests
// that exercise email confirmation explicitly (TC-J1-05/07) use the
// password-recovery flow, which DOES send Mailpit emails regardless.

const VALID_PASSWORD = 'Test1234!Phase5d'
const REPLACEMENT_PASSWORD = 'Replace1234!Phase5d'

function uniqueEmail(tag: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return `j1-${tag}-${stamp}@stelavox.test`
}

let createdEmails: string[] = []

test.beforeEach(async () => {
  createdEmails = []
})

test.afterEach(async () => {
  // Cascade-cleanup any users this test created. Deleting the auth user
  // cascades to organisation_members + organisations + projects via FKs.
  for (const email of createdEmails) {
    await deleteUserByEmail(email).catch(() => {})
  }
})

// ─── Happy paths ────────────────────────────────────────────────────────────

test('TC-J1-01: signup with valid form provisions org and lands on dashboard', async ({ page }) => {
  const email = uniqueEmail('01')
  createdEmails.push(email)

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.submit({ name: 'Author One', email, password: VALID_PASSWORD })

  // Local config has enable_confirmations=false → direct redirect.
  await signup.expectLandedOnDashboard()

  // Integration-seam assertions: org + membership were atomically created
  // (H-03 trigger) and the membership row points at a real org.
  const user = await findUserByEmail(email)
  expect(user).toBeTruthy()

  const admin = adminClient()
  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id, role')
    .eq('user_id', user!.id)
    .single()
  expect(member?.role).toBe('owner')

  const { data: org } = await admin
    .from('organisations')
    .select('id')
    .eq('id', member!.organisation_id)
    .single()
  expect(org).toBeTruthy()
})

test('TC-J1-05: forgot-password sends a reset email that lands on /reset-password', async ({ page }) => {
  const email = uniqueEmail('05')
  createdEmails.push(email)

  // Pre-create the account (skip the signup UI so this case targets the
  // reset flow only).
  const admin = adminClient()
  const { error: createErr } = await admin.auth.admin.createUser({
    email,
    password: VALID_PASSWORD,
    email_confirm: true,
  })
  expect(createErr).toBeNull()
  // Wait for H-03 org-provision trigger.
  await new Promise(r => setTimeout(r, 300))

  const forgot = new ForgotPasswordPage(page)
  await forgot.goto()
  await forgot.submit(email)
  await forgot.expectAlwaysSuccessMessage()

  const verify = new EmailVerificationPage(page)
  const link = await verify.pollForLinkOrThrow(email, 15_000)
  expect(link).toContain('http')

  await verify.visit(link)

  const reset = new ResetPasswordPage(page)
  await reset.expectOnPage()
})

test('TC-J1-07: reset-password via valid recovery token; new password works', async ({ page }) => {
  const email = uniqueEmail('07')
  createdEmails.push(email)

  const admin = adminClient()
  await admin.auth.admin.createUser({ email, password: VALID_PASSWORD, email_confirm: true })
  await new Promise(r => setTimeout(r, 300))

  // Trigger reset → email → click link → land on /reset-password
  const forgot = new ForgotPasswordPage(page)
  await forgot.goto()
  await forgot.submit(email)
  await forgot.expectAlwaysSuccessMessage()

  const verify = new EmailVerificationPage(page)
  const link = await verify.pollForLinkOrThrow(email, 15_000)
  await verify.visit(link)

  const reset = new ResetPasswordPage(page)
  await reset.expectOnPage()
  await reset.submit(REPLACEMENT_PASSWORD)
  await reset.expectLandedOnDashboard()

  // Sign out, then sign back in with the new password to prove it sticks.
  await page.goto(`${APP_URL}/login`)
  await page.context().clearCookies()
  const login = new LoginPage(page)
  await login.goto()
  await login.submit(email, REPLACEMENT_PASSWORD)
  await login.expectLandedOnDashboard()
})

test('TC-J1-10: login with valid credentials redirects to dashboard @cloud', async ({ page }) => {
  // Re-uses the seeded USERS.A from global-setup so cloud-smoke can run
  // against an existing user without provisioning. Cleanup is intentionally
  // omitted — A is a shared seed user across the suite.
  const login = new LoginPage(page)
  await login.goto()
  await login.submit(USERS.A.email, USERS.A.password)
  await login.expectLandedOnDashboard()

  const dashboard = new DashboardPage(page)
  await dashboard.expectAuthenticated()
})

test('TC-J1-13: newly-signed-up user lands on dashboard with empty project state', async ({ page }) => {
  const email = uniqueEmail('13')
  createdEmails.push(email)

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.submit({ name: 'Empty State Author', email, password: VALID_PASSWORD })
  await signup.expectLandedOnDashboard()

  const dashboard = new DashboardPage(page)
  await dashboard.expectAuthenticated()

  // Verify DB-level emptiness: this user's org has zero projects.
  const user = await findUserByEmail(email)
  const admin = adminClient()
  const { data: member } = await admin
    .from('organisation_members')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .single()
  const { count: projectCount } = await admin
    .from('projects')
    .select('id', { count: 'exact', head: true })
    .eq('organisation_id', member!.organisation_id)
  expect(projectCount).toBe(0)

  // UI affordance: a "New project" CTA is reachable.
  await expect(dashboard.newProjectButton).toBeVisible({ timeout: 5_000 })
})

test('TC-J1-14: logout from header redirects to /login; dashboard redirects unauthenticated', async ({ page }) => {
  // Note: trilogy described "second tab also de-authed (Realtime broadcast)".
  // Cross-tab logout in Stelavox is mediated by Supabase's localStorage auth
  // sync, NOT Realtime. The Test Report records this clarification. This
  // case asserts the single-tab logout contract: explicit signout + dashboard
  // navigation redirects to /login.
  const email = uniqueEmail('14')
  createdEmails.push(email)

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.submit({ name: 'Logout Author', email, password: VALID_PASSWORD })
  await signup.expectLandedOnDashboard()

  const dashboard = new DashboardPage(page)
  await dashboard.clickSignOut()
  await dashboard.expectRedirectedToLogin()

  // Navigating back to /dashboard while unauthenticated bounces to /login.
  await page.goto(`${APP_URL}/dashboard`)
  await page.waitForURL(/\/login/, { timeout: 10_000 })
  expect(page.url()).toContain('/login')
})

// ─── Common-sad paths ───────────────────────────────────────────────────────

test('TC-J1-02: signup with existing email does not create a second user (anti-enumeration)', async ({ page }) => {
  const email = uniqueEmail('02')
  createdEmails.push(email)

  // Pre-create the account.
  const admin = adminClient()
  await admin.auth.admin.createUser({ email, password: VALID_PASSWORD, email_confirm: true })
  await new Promise(r => setTimeout(r, 300))

  // Count users + memberships before the duplicate signup attempt.
  const { data: usersBefore } = await admin.auth.admin.listUsers({ perPage: 200 })
  const usersWithEmailBefore = (usersBefore?.users ?? []).filter(u => u.email === email)
  expect(usersWithEmailBefore.length).toBe(1)

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.submit({ name: 'Duplicate Attempt', email, password: VALID_PASSWORD })

  // Supabase anti-enumeration: with email-confirmation off, the duplicate
  // signup either surfaces "User already registered" OR shows the
  // "Check your email" pseudo-message. Either is privacy-preserving — the
  // assertion is that NO second user row was created.
  await page.waitForTimeout(1_500)
  const url = page.url()
  expect(url).not.toContain('/dashboard') // never silently auth as the existing user

  const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 200 })
  const usersWithEmailAfter = (usersAfter?.users ?? []).filter(u => u.email === email)
  expect(usersWithEmailAfter.length).toBe(1)
})

test('TC-J1-03: signup with sub-8-char password is blocked by client validation', async ({ page }) => {
  const email = uniqueEmail('03')
  // No createdEmails push — no user should land in the DB.

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.nameInput.fill('Weak Pass Author')
  await signup.emailInput.fill(email)
  await signup.passwordInput.fill('short')
  await signup.confirmInput.fill('short')
  await signup.submitButton.click()

  // HTML5 minlength=8 on the password input prevents submission. The
  // browser keeps focus on /signup; URL does not change.
  await page.waitForTimeout(500)
  await signup.expectStillOnSignup()

  // Defence-in-depth: no user row created.
  const user = await findUserByEmail(email)
  expect(user).toBeNull()
})

test('TC-J1-06: forgot-password for unknown email shows always-success message and creates no row', async ({ page }) => {
  const unknownEmail = uniqueEmail('06-unknown')

  const admin = adminClient()
  const { data: usersBefore } = await admin.auth.admin.listUsers({ perPage: 200 })
  const before = (usersBefore?.users ?? []).filter(u => u.email === unknownEmail).length
  expect(before).toBe(0)

  const forgot = new ForgotPasswordPage(page)
  await forgot.goto()
  await forgot.submit(unknownEmail)
  await forgot.expectAlwaysSuccessMessage()

  // Privacy: no user row created and no email sent.
  const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 200 })
  const after = (usersAfter?.users ?? []).filter(u => u.email === unknownEmail).length
  expect(after).toBe(0)

  // No reset email arrives (Mailpit empty for this address). Short timeout
  // since we're asserting absence; 5s is plenty for a non-arriving email.
  const link = await pollForLink(unknownEmail, 5_000)
  expect(link).toBeNull()
})

test('TC-J1-08: reset-password with malformed token redirects to /login with error', async ({ page }) => {
  // Visit /auth/callback with a deliberately-broken code.
  await page.goto(`${APP_URL}/auth/callback?code=this-is-not-a-real-recovery-code&next=/reset-password`)

  // The callback route exchangeCodeForSession fails and redirects to
  // /login?error=verification_failed.
  await page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 })
  expect(page.url()).toContain('/login')
  expect(page.url()).toContain('error')
})

test('TC-J1-11: login with wrong password surfaces invalid-credentials error', async ({ page }) => {
  // Use the seeded USERS.B account; we don't push to createdEmails since
  // we're not modifying it.
  const login = new LoginPage(page)
  await login.goto()
  await login.submit(USERS.B.email, 'absolutely-not-the-real-password')
  await login.expectError(/Invalid email or password/i)
  // URL stays on /login.
  await page.waitForTimeout(500)
  expect(page.url()).toContain('/login')
})

test('TC-J1-12: login attempt rate-limit', async () => {
  test.skip(true,
    'Local Supabase config does not enforce login rate-limit by default. ' +
    'Behaviour is provider-side and only observable on cloud. Cloud-smoke ' +
    'or a dedicated cloud-only spec would cover this; queued as J1 SU candidate.',
  )
})

// ─── Security-sad paths ─────────────────────────────────────────────────────

test('TC-J1-04: signup name field with HTML/script injection is sanitised', async ({ page }) => {
  const email = uniqueEmail('04')
  createdEmails.push(email)

  const malicious = '<script>window.__pwned=true</script><img src=x onerror="window.__pwned=true">'

  const signup = new SignupPage(page)
  await signup.goto()
  await signup.submit({ name: malicious, email, password: VALID_PASSWORD })
  await signup.expectLandedOnDashboard()

  // Verify the name was stored as literal text in user_metadata.
  const user = await findUserByEmail(email)
  expect(user).toBeTruthy()
  const admin = adminClient()
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 200 })
  const hydrated = (list?.users ?? []).find(u => u.email === email)
  expect(hydrated?.user_metadata?.name).toBe(malicious)

  // No script execution: window.__pwned never set on the dashboard.
  const pwned = await page.evaluate(() => (window as { __pwned?: boolean }).__pwned === true)
  expect(pwned).toBe(false)
})

test('TC-J1-09: replay of consumed recovery token is rejected', async ({ page }) => {
  const email = uniqueEmail('09')
  createdEmails.push(email)

  const admin = adminClient()
  await admin.auth.admin.createUser({ email, password: VALID_PASSWORD, email_confirm: true })
  await new Promise(r => setTimeout(r, 300))

  // First use of the recovery link — succeeds.
  const forgot = new ForgotPasswordPage(page)
  await forgot.goto()
  await forgot.submit(email)
  await forgot.expectAlwaysSuccessMessage()

  const verify = new EmailVerificationPage(page)
  const link = await verify.pollForLinkOrThrow(email, 15_000)

  await verify.visit(link)
  const reset = new ResetPasswordPage(page)
  await reset.expectOnPage()
  await reset.submit(REPLACEMENT_PASSWORD)
  await reset.expectLandedOnDashboard()

  // Sign out so the second visit is unauthenticated.
  await page.context().clearCookies()

  // Replay the same link — Supabase PKCE auth code is single-use; the
  // callback fails the exchange and redirects to /login?error=verification_failed.
  await verify.visit(link)
  await page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 })
  expect(page.url()).toContain('/login')
})
