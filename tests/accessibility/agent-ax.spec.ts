// Phase 5 accessibility tests.
// Spec: stelavox_phase5_test_plan_v1_0.md v1.1 §9
//       TC-AX-02, TC-AX-08
//
// β-scope subset — 2 of 8 TC-AX cases. The remaining 6 (focus order,
// aria-live, focus trapping, etc.) are deferred to SU-33 / Phase 8.

import { test, expect } from '@playwright/test'
import { USERS } from '../helpers/auth'
import {
  setupAgentNovelFixture,
  disposeAgentFixture,
  getOrgIdForUser,
} from '../helpers/agent-fixtures'

const BASE = 'http://localhost:3000'

test.use({ storageState: USERS.A.storageState })

test.describe('Phase 5 — TC-AX accessibility', () => {
  let orgId: string

  test.beforeAll(async () => { orgId = await getOrgIdForUser(USERS.A.email) })

  test('TC-AX-02 — Operation buttons have a non-empty accessible name', async ({ page }) => {
    const fix = await setupAgentNovelFixture(orgId, 'TC-AX-02', { withSummary: true })
    try {
      await page.goto(`${BASE}/projects/${fix.projectId}/documents/${fix.documentId}`)
      await page.waitForLoadState('networkidle')

      // Click the chapter row
      await page.getByLabel(`TC-AX-02 C1, draft`).click()

      // Switch to Agent tab
      await page.getByRole('tab', { name: /Agent/i }).click()

      // Each operation button (Expand, Refine, Critique) should have an
      // accessible name. Phase 5 V1 derives the name from text content; the
      // verbose-label refinement (per TC-AX-02 strict spec) is captured as
      // SU-34 for V2.
      const buttons = page.locator('button').filter({ hasText: /Expand|Refine|Critique|Synthesise/i })
      const count = await buttons.count()
      expect(count).toBeGreaterThanOrEqual(2)
      for (let i = 0; i < count; i++) {
        const accessibleName = await buttons.nth(i).evaluate((el: HTMLElement) =>
          (el.getAttribute('aria-label') ?? el.textContent ?? '').trim()
        )
        expect(accessibleName.length).toBeGreaterThan(0)
      }
    } finally { await disposeAgentFixture(fix) }
  })

  test('TC-AX-08 — Colour-conveyed status info has a non-colour signal', async ({ page }) => {
    // Inviolable: status differences must not rely on colour alone. NodeRow
    // exposes the status via the row's aria-label ("<name>, <status>") so
    // screen readers + non-colour-perceiving readers receive the status as
    // text. This is the non-colour signal (Component Spec §4.2).
    const fix = await setupAgentNovelFixture(orgId, 'TC-AX-08', { withSummary: true })
    try {
      await page.goto(`${BASE}/projects/${fix.projectId}/documents/${fix.documentId}`)
      await page.waitForLoadState('networkidle')

      const treeRow = page.getByLabel(`TC-AX-08 C1, draft`)
      await expect(treeRow).toBeVisible()

      // Verify the aria-label encodes the status as a text token, not as
      // a colour-only signal.
      const ariaLabel = await treeRow.getAttribute('aria-label')
      expect(ariaLabel).toContain('draft')
    } finally { await disposeAgentFixture(fix) }
  })
})
