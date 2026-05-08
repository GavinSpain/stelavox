import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Document editor + NodeTree surface (S-DOC-01, S-DOC-05, S-DOC-06,
 * S-DOC-07). Composes the editor entry point with tree interactions.
 *
 * NodeRow exposes an accessible name `{name}, {status}` (e.g. "Act One,
 * draft") on the row's outer element. Hover actions (Add child, More)
 * are inside the row and revealed on hover.
 */
export class NodeTreePage {
  readonly page: Page
  readonly projectId: string
  readonly docId: string

  constructor(page: Page, projectId: string, docId: string) {
    this.page = page
    this.projectId = projectId
    this.docId = docId
  }

  async goto() {
    await this.page.goto(`${APP_URL}/projects/${this.projectId}/documents/${this.docId}`)
    await this.page.waitForLoadState('networkidle')
  }

  get tree(): Locator { return this.page.getByRole('tree') }
  get emptyHint(): Locator { return this.page.locator('[data-testid="empty-tree-hint"]') }

  row(name: string, status: string = 'draft'): Locator {
    return this.page.getByLabel(`${name}, ${status}`)
  }

  async hoverRow(name: string, status: string = 'draft') {
    await this.row(name, status).hover()
  }

  async clickAddChild(parentName: string, parentStatus: string = 'draft') {
    const row = this.row(parentName, parentStatus)
    await row.hover()
    await row.getByRole('button', { name: 'Add child' }).click()
  }

  async openMoreMenu(name: string, status: string = 'draft') {
    const row = this.row(name, status)
    await row.hover()
    await row.getByRole('button', { name: 'More' }).click()
  }

  get menu(): Locator { return this.page.locator('[role="menu"]') }
  menuItem(name: string | RegExp): Locator { return this.menu.getByRole('menuitem', { name }) }

  async expectRowVisible(name: string, status: string = 'draft') {
    await expect(this.row(name, status)).toBeVisible({ timeout: 5_000 })
  }

  async expectRowMissing(name: string, status: string = 'draft') {
    await expect(this.row(name, status)).toHaveCount(0)
  }

  async waitForTreeRender(timeout = 10_000) {
    // The tree is mounted server-side after RPC fetch. Wait for at least
    // one row OR the empty hint.
    await expect.poll(async () => {
      const trees = await this.tree.count()
      const hints = await this.emptyHint.count()
      return trees + hints > 0
    }, { timeout }).toBeGreaterThan(0)
  }
}
