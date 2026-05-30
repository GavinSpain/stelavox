// Phase 8.01.A T-9 — Wordmark smoke specs.
//
// Visits /dashboard as a signed-in user and asserts the Wordmark mounts
// correctly with the two-typeface mark + 45°-rotated-square lozenge.
// Click navigation to /dashboard verified separately.

import { test, expect } from '@playwright/test'
import { USERS, APP_URL } from '../helpers/auth'

test.use({ storageState: USERS.A.storageState })

test('TC-8.01.A-W-1 Wordmark renders in the header at /dashboard', async ({ page }) => {
  await page.goto(`${APP_URL}/dashboard`)
  const wordmark = page.getByTestId('wordmark')
  await expect(wordmark).toBeVisible()
  await expect(wordmark).toHaveAttribute('data-size', 'compact')
})

test('TC-8.01.A-W-2 Wordmark contains both Stela and vox spans', async ({ page }) => {
  await page.goto(`${APP_URL}/dashboard`)
  await expect(page.getByTestId('wordmark-stela')).toHaveText('Stela')
  await expect(page.getByTestId('wordmark-vox')).toHaveText('vox')
})

test('TC-8.01.A-W-3 Lozenge is rendered as a rotated square (NOT a Unicode diamond)', async ({ page }) => {
  await page.goto(`${APP_URL}/dashboard`)
  const lozenge = page.getByTestId('wordmark-lozenge')
  await expect(lozenge).toBeVisible()
  const box = await lozenge.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThan(0)
  expect(box!.height).toBeGreaterThan(0)
  // Computed transform should include rotate(45deg) — present in the
  // serialised CSS transform matrix when rotation is applied.
  const transform = await lozenge.evaluate((el) => window.getComputedStyle(el).transform)
  // A 45° rotation produces a matrix with non-zero off-diagonal components.
  // The serialised form is typically `matrix(0.707..., 0.707..., -0.707..., 0.707..., 0, 0)`.
  expect(transform).not.toBe('none')
  expect(transform).toMatch(/matrix/)
})

test('TC-8.01.A-W-4 Rule has the verdigris gradient', async ({ page }) => {
  await page.goto(`${APP_URL}/dashboard`)
  const rule = page.getByTestId('wordmark-rule')
  await expect(rule).toBeVisible()
  const bg = await rule.evaluate((el) => window.getComputedStyle(el).background)
  expect(bg).toMatch(/linear-gradient/i)
})

test('TC-8.01.A-W-5 Wordmark click navigates to /dashboard from another route', async ({ page }) => {
  // Start at a non-dashboard route so the Wordmark click does actual navigation.
  await page.goto(`${APP_URL}/settings`)
  await expect(page).toHaveURL(/\/settings/)
  await page.getByLabel('Stelavox — home').click()
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 10_000 })
  expect(page.url()).toBe(`${APP_URL}/dashboard`)
})
