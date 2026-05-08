import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

export class DashboardPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get heading(): Locator { return this.page.getByRole('heading', { name: /Projects|Dashboard|Welcome/ }).first() }
  get newProjectButton(): Locator { return this.page.getByRole('button', { name: /New project/i }) }
  get signOutButton(): Locator { return this.page.getByRole('button', { name: /Sign out/i }) }

  async goto() {
    await this.page.goto(`${APP_URL}/dashboard`)
  }

  async expectAuthenticated() {
    await this.page.waitForURL(`${APP_URL}/dashboard`, { timeout: 10_000 })
  }

  async expectRedirectedToLogin() {
    await this.page.waitForURL(/\/login/, { timeout: 10_000 })
  }

  async expectUserBadge(email: string) {
    await expect(this.page.locator(`text=${email}`)).toBeVisible({ timeout: 5_000 })
  }

  async clickSignOut() {
    await this.signOutButton.click()
  }
}
