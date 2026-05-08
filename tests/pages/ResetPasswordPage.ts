import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Selector strategy: see LoginPage. Type-based selectors. Reset form has
 * two password inputs (new + confirm).
 */
export class ResetPasswordPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get newPasswordInput(): Locator { return this.page.locator('input[type="password"]').first() }
  get confirmInput(): Locator { return this.page.locator('input[type="password"]').nth(1) }
  get submitButton(): Locator { return this.page.locator('button[type="submit"]') }
  get errorBanner(): Locator { return this.page.locator('p').filter({ hasText: /password|match|invalid|expired|token/i }) }

  async expectOnPage() {
    await this.page.waitForURL(/\/reset-password/, { timeout: 10_000 })
  }

  async submit(newPassword: string, confirm?: string) {
    await this.newPasswordInput.fill(newPassword)
    await this.confirmInput.fill(confirm ?? newPassword)
    await this.submitButton.click()
  }

  async expectLandedOnDashboard() {
    await this.page.waitForURL(/\/dashboard/, { timeout: 15_000 })
  }

  async expectError(matcher: RegExp | string) {
    await expect(this.errorBanner.first()).toBeVisible({ timeout: 5_000 })
    await expect(this.errorBanner.first()).toContainText(matcher)
  }

  async expectRedirectedAwayFromReset() {
    // When a recovery token is invalid/consumed, /auth/callback redirects to
    // /login?error=verification_failed instead of landing on /reset-password.
    await this.page.waitForURL(/\/login(\?|$)/, { timeout: 10_000 })
  }
}
