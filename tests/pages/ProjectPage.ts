import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Project detail surface (S-PROJ-02) at /projects/[projectId]. Hosts the
 * document list and the NewDocumentModal trigger.
 */
export class ProjectPage {
  readonly page: Page
  readonly projectId: string

  constructor(page: Page, projectId: string) {
    this.page = page
    this.projectId = projectId
  }

  get heading(): Locator { return this.page.getByRole('heading').first() }
  get newDocumentButton(): Locator { return this.page.locator('button:has-text("New document")') }
  get backToProjectsLink(): Locator { return this.page.getByRole('link', { name: /Projects/i }).first() }
  get emptyMessage(): Locator { return this.page.locator('p').filter({ hasText: /No documents yet/i }) }

  async goto() {
    await this.page.goto(`${APP_URL}/projects/${this.projectId}`)
  }

  async expectVisible() {
    await this.page.waitForURL(`${APP_URL}/projects/${this.projectId}`, { timeout: 10_000 })
  }

  async expectDocumentVisible(name: string) {
    await expect(this.page.locator(`text=${name}`).first()).toBeVisible({ timeout: 5_000 })
  }

  async expectDocumentNotVisible(name: string) {
    await expect(this.page.locator(`text=${name}`)).toHaveCount(0)
  }

  async clickNewDocument() {
    await this.newDocumentButton.click()
  }

  async clickDocumentLink(name: string) {
    await this.page.getByRole('link').filter({ hasText: name }).first().click()
  }

  // ─── NewDocumentModal interactions ────────────────────────────────────────

  modalNameInput(): Locator { return this.page.locator('input[type="text"]').first() }
  modalDescriptionInput(): Locator { return this.page.locator('textarea').first() }
  modalDocTypeSelect(): Locator { return this.page.locator('select').first() }
  modalSubmitButton(): Locator { return this.page.getByRole('button', { name: /^(Create|Creating)/ }).last() }
  modalCancelButton(): Locator { return this.page.getByRole('button', { name: /^Cancel$/ }) }
  modalErrorBanner(): Locator { return this.page.locator('p').filter({ hasText: /Failed|name|invalid/i }) }

  async createDocument(opts: { name: string; description?: string; docType?: 'novel' | 'short_story' | 'series' }) {
    await this.clickNewDocument()
    await this.modalNameInput().fill(opts.name)
    if (opts.description) await this.modalDescriptionInput().fill(opts.description)
    if (opts.docType) await this.modalDocTypeSelect().selectOption(opts.docType)
    await this.modalSubmitButton().click()
  }
}
