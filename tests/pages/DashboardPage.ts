import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Dashboard surface (S-PROJ-01) plus its NewProjectModal trigger and
 * project-list affordances. Phase 5d J1 used .heading + signOut; J2
 * extends with project-list interactions.
 */
export class DashboardPage {
  readonly page: Page

  constructor(page: Page) {
    this.page = page
  }

  get heading(): Locator { return this.page.getByRole('heading', { name: /^Projects$/ }).first() }
  get newProjectButton(): Locator { return this.page.locator('button:has-text("New project")') }
  get signOutButton(): Locator { return this.page.getByRole('button', { name: /Sign out/i }) }
  get emptyMessage(): Locator { return this.page.locator('p').filter({ hasText: /No projects yet/i }) }

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

  // J2 additions

  projectLink(name: string): Locator {
    return this.page.getByRole('link').filter({ hasText: new RegExp(`^${escape(name)}$`) }).first()
  }

  projectMenu(): Locator {
    return this.page.locator('[data-testid="project-menu"]')
  }

  async clickNewProject() {
    await this.newProjectButton.click()
  }

  async expectProjectVisible(name: string) {
    await expect(this.page.locator(`text=${name}`).first()).toBeVisible({ timeout: 5_000 })
  }

  async expectProjectNotVisible(name: string) {
    await expect(this.page.locator(`text=${name}`)).toHaveCount(0)
  }

  // ─── NewProjectModal interactions (modal is a child of Dashboard) ─────────

  modalNameInput(): Locator { return this.page.locator('input[type="text"]').first() }
  modalSubmitButton(): Locator { return this.page.getByRole('button', { name: /^(Create|Creating)/ }).last() }
  modalCancelButton(): Locator { return this.page.getByRole('button', { name: /^Cancel$/ }) }
  modalErrorBanner(): Locator { return this.page.locator('p').filter({ hasText: /Failed|already|name|invalid/i }) }
  modalDescriptionInput(): Locator { return this.page.locator('textarea').first() }
  modalDocTypeSelect(): Locator { return this.page.locator('select').first() }

  async createProject(opts: { name: string; description?: string; docType?: 'novel' | 'short_story' | 'series' }) {
    await this.clickNewProject()
    await this.modalNameInput().fill(opts.name)
    if (opts.description) await this.modalDescriptionInput().fill(opts.description)
    if (opts.docType) await this.modalDocTypeSelect().selectOption(opts.docType)
    await this.modalSubmitButton().click()
  }
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
