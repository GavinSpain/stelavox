import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Selector strategy: the auth forms (app/(auth)/login/LoginForm.tsx) place
 * <label> as a sibling of <input>, NOT linked via htmlFor. getByLabel cannot
 * match. We use type-based selectors which are stable HTML semantic contracts
 * — `input[type="email"]` will not silently shift if styling changes.
 */
export class LoginPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get emailInput(): Locator { return this.page.locator('input[type="email"]') }
  get passwordInput(): Locator { return this.page.locator('input[type="password"]') }
  get submitButton(): Locator { return this.page.locator('button[type="submit"]') }
  get magicLinkToggle(): Locator { return this.page.getByRole('button', { name: /Sign in with magic link|Use password instead/ }) }
  get errorBanner(): Locator { return this.page.locator('p').filter({ hasText: /Invalid email or password|already in use|email rate limit|error/i }) }
  get forgotPasswordLink(): Locator { return this.page.getByRole('link', { name: /Forgot password\?/ }) }
  get signupLink(): Locator { return this.page.getByRole('link', { name: /Create one/ }) }

  async goto() {
    await this.page.goto(`${APP_URL}/login`)
  }

  async submit(email: string, password: string) {
    await this.emailInput.fill(email)
    await this.passwordInput.fill(password)
    await this.submitButton.click()
  }

  async expectError(matcher: RegExp | string) {
    await expect(this.errorBanner.first()).toBeVisible({ timeout: 5_000 })
    await expect(this.errorBanner.first()).toContainText(matcher)
  }

  async expectLandedOnDashboard() {
    await this.page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
  }
}
