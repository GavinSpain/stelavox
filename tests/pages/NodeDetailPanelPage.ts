import { Page, Locator, expect } from '@playwright/test'
import { APP_URL } from '../helpers/auth'

/**
 * Node detail panel surfaces (S-DET-01..S-DET-15). Opens the document
 * editor, clicks a node row, asserts the detail panel mounts.
 *
 * Editor selectors leverage the established Phase 3 contract:
 *   [data-editor="summary|prose|notes"] .tiptap
 * which is stable across UI redesigns.
 */
export class NodeDetailPanelPage {
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

  /**
   * Open a specific node by clicking its tree row. The aria-label
   * follows `{name}, {status}`.
   */
  async openNode(name: string, status: string = 'draft') {
    await this.page.getByLabel(`${name}, ${status}`).click()
    await expect(this.page.getByTestId('node-name-heading')).toBeVisible({ timeout: 5_000 })
  }

  // Editor body locators — stable contracts via data-editor attribute.
  get summaryEditor(): Locator { return this.page.locator('[data-editor="summary"] .tiptap') }
  get proseEditor(): Locator { return this.page.locator('[data-editor="prose"] .tiptap') }
  get notesEditor(): Locator { return this.page.locator('[data-editor="notes"] .tiptap') }

  // TabStrip
  get tabStrip(): Locator { return this.page.locator('[role="tablist"]').first() }
  tab(name: RegExp | string): Locator { return this.page.getByRole('tab', { name }) }

  // FocusMode trigger
  get focusModeButton(): Locator { return this.page.getByRole('button', { name: /Focus Mode|Focus mode/i }) }

  // WordCount
  get wordCount(): Locator { return this.page.getByTestId('word-count') }

  // ConflictBanner
  get conflictBanner(): Locator { return this.page.getByTestId('conflict-banner') }

  // SelectionTooltip
  get selectionTooltip(): Locator { return this.page.locator('[role="toolbar"]').first() }
}
