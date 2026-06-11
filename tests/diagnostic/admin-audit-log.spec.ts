/**
 * Diagnostic / visual verification: the DR-096 admin audit-log section
 * renders rows, severity chips filter, and click expands metadata.
 *
 * Run: npx playwright test tests/diagnostic/admin-audit-log.spec.ts --reporter=list --workers=1 --retries=0
 */

import { test, expect } from '@playwright/test'

const APP_URL = 'http://localhost:3000'
const EMAIL = 'author@stelavox.local'
const PASSWORD = 'Test1234!Test1234!'

test('admin audit-log section renders + filters + expands', async ({ page }) => {
  test.setTimeout(120000)

  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard|\/projects/, { timeout: 20000 })

  await page.goto(`${APP_URL}/admin`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  // Section present.
  const section = page.locator('[data-testid="admin-audit-log"]')
  await expect(section).toBeVisible({ timeout: 15000 })

  // Switch to 7d window so the seeded/test rows are inside it.
  await page.locator('button', { hasText: /^7d$/ }).click()
  await page.waitForTimeout(1500)

  const rows = page.locator('[data-testid="audit-log-row"]')
  const rowCount = await rows.count()
  console.log(`[audit-section] ${rowCount} rows visible (7d window)`)
  expect(rowCount).toBeGreaterThan(0)

  // Click first row → expansion appears with metadata JSON.
  await rows.first().click()
  const expand = page.locator('[data-testid="audit-log-expand"]')
  await expect(expand).toBeVisible()
  const expandText = await expand.textContent()
  expect(expandText).toContain('event_type:')
  expect(expandText).toContain('metadata:')

  // Click again → collapses.
  await rows.first().click()
  await expect(expand).not.toBeVisible()

  // Severity chip filter narrows the list (click High; row count <= total).
  const highChip = section.locator('button', { hasText: /High \(/ })
  if (await highChip.isVisible()) {
    await highChip.click()
    const filtered = await rows.count()
    console.log(`[audit-section] High-filtered rows: ${filtered}`)
    expect(filtered).toBeLessThanOrEqual(rowCount)
  }

  await page.screenshot({ path: 'tests/diagnostic/admin-audit-log.png', fullPage: false })
})
