import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Selector strategy: see LoginPage. Type-based selectors used because the
 * auth forms have unlinked <label>/<input> siblings.
 *
 * Signup form: text (name), email, password, password (confirm).
 */
export class SignupPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get nameInput(): Locator { return this.page.locator('input[type="text"]') }
  get emailInput(): Locator { return this.page.locator('input[type="email"]') }
  get passwordInput(): Locator { return this.page.locator('input[type="password"]').first() }
  get confirmInput(): Locator { return this.page.locator('input[type="password"]').nth(1) }
  get submitButton(): Locator { return this.page.locator('button[type="submit"]') }
  get errorBanner(): Locator { return this.page.locator('p').filter({ hasText: /already|do not match|password|email|invalid/i }) }
  get checkEmailHeading(): Locator { return this.page.getByRole('heading', { name: 'Check your email' }) }

  async goto() {
    await this.page.goto(`${APP_URL}/signup`)
  }

  async submit(opts: { name: string; email: string; password: string; confirm?: string }) {
    await this.nameInput.fill(opts.name)
    await this.emailInput.fill(opts.email)
    await this.passwordInput.fill(opts.password)
    await this.confirmInput.fill(opts.confirm ?? opts.password)
    await this.submitButton.click()
  }

  async expectLandedOnDashboard() {
    await this.page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
  }

  async expectError(matcher: RegExp | string) {
    await expect(this.errorBanner.first()).toBeVisible({ timeout: 5_000 })
    await expect(this.errorBanner.first()).toContainText(matcher)
  }

  async expectStillOnSignup() {
    await expect(this.page).toHaveURL(/\/signup/)
  }

  async expectCheckEmailMessage() {
    await expect(this.checkEmailHeading).toBeVisible({ timeout: 5_000 })
  }
}
