import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Document editor + NodeTree surface (S-DOC-01, S-DOC-05, S-DOC-06,
 * S-DOC-07).
 *
 * Readiness pattern (J2.B-resolved per SU-J2-3):
 *   1. goto + waitForLoadState('networkidle') is the existing Phase 2
 *      pattern that works.
 *   2. Don't poll for role="tree" presence — that's over-engineered.
 *      Trust Playwright's auto-wait on the row locator: a `getByLabel`
 *      operation will wait up to the action timeout for the labelled
 *      element to appear, regardless of where it lives in the tree.
 *   3. Row labels follow `{name}, {status}` per NodeRow.tsx aria-label.
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

  row(name: string, status: string = 'draft'): Locator {
    return this.page.getByLabel(`${name}, ${status}`)
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

  async expectRowVisible(name: string, status: string = 'draft', timeout = 5_000) {
    await expect(this.row(name, status)).toBeVisible({ timeout })
  }

  async expectRowMissing(name: string, status: string = 'draft') {
    await expect(this.row(name, status)).toHaveCount(0)
  }

  /**
   * Resolve the doc's auto-generated name from the DB so tests can
   * locate the root row by aria-label without hardcoding.
   */
  async getRootRowLabel(adminClient: { from: (t: 'documents') => unknown }): Promise<string> {
    const admin = adminClient as unknown as {
      from: (t: 'documents') => {
        select: (cols: string) => {
          eq: (k: string, v: string) => {
            single: () => Promise<{ data: { name: string } | null }>
          }
        }
      }
    }
    const { data } = await admin.from('documents').select('name').eq('id', this.docId).single()
    if (!data) throw new Error(`getRootRowLabel: document ${this.docId} not found`)
    return data.name
  }
}
