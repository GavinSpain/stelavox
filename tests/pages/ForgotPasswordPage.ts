import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Selector strategy: see LoginPage. Type-based selectors.
 */
export class ForgotPasswordPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get emailInput(): Locator { return this.page.locator('input[type="email"]') }
  get submitButton(): Locator { return this.page.locator('button[type="submit"]') }
  get successHeading(): Locator { return this.page.getByRole('heading', { name: 'Check your email' }) }
  get successBody(): Locator { return this.page.locator('p').filter({ hasText: /If an account exists/ }) }

  async goto() {
    await this.page.goto(`${APP_URL}/forgot-password`)
  }

  async submit(email: string) {
    await this.emailInput.fill(email)
    await this.submitButton.click()
  }

  async expectAlwaysSuccessMessage() {
    // Privacy: always-success message regardless of whether email exists.
    await expect(this.successHeading).toBeVisible({ timeout: 5_000 })
    await expect(this.successBody).toContainText(/If an account exists/)
  }
}
