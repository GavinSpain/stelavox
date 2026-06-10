/**
 * Diagnostic: verify Sentence Focus produces three opacity tiers
 * (active 1.0 / adjacent 0.85 / others 0.55) in a real browser.
 *
 * Run: npx playwright test tests/diagnostic/sentence-focus-tiers.spec.ts --reporter=list --workers=1 --retries=0
 */

import { test, expect } from '@playwright/test'

const APP_URL = 'http://localhost:3000'
const EMAIL = 'author@stelavox.local'
const PASSWORD = 'Test1234!Test1234!'

test('Sentence Focus produces 3 opacity tiers in Edit mode', async ({ page }) => {
  test.setTimeout(120000)

  // ─── Sign in ───
  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard|\/projects/, { timeout: 20000 })

  // ─── Force the localStorage key BEFORE loading the doc so the
  //     SentenceFocus CSS is installed on first mount. ───
  await page.addInitScript(() => {
    window.localStorage.setItem('stelavox_sentence_focus_enabled', 'true')
  })

  // ─── Go to a known leaf beat with multi-sentence prose ───
  // Shadow Protocol → Act 1 → Ch1 (Salvage) → Sc1 (The Iron Ghost) → Bt1 (The Signal)
  const projectId = '084fa459-946e-4288-ac28-30e687962ee6'
  const documentId = '637acf44-38ab-42ad-b179-1d57844014b5'
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  // Click the first beat node — "The Signal" — to land in the leaf detail.
  const signalRow = page.locator('[data-testid="node-row-name"]', { hasText: 'The Signal' }).first()
  await signalRow.click()
  await page.waitForTimeout(500)

  // Confirm the data-sentence-focus container is up
  const focusRoot = page.locator('[data-sentence-focus]')
  await expect(focusRoot).toBeAttached({ timeout: 5000 })

  // Click in the middle of the prose body to set a cursor.
  const proseBody = page.locator('[data-editor="prose"]').first()
  await proseBody.click({ position: { x: 150, y: 80 } })
  await page.waitForTimeout(300)

  // Enumerate sentences and their computed opacity.
  const tiers = await page.evaluate(() => {
    const sentences = Array.from(document.querySelectorAll('[data-sentence]'))
    return sentences.map((el) => {
      const e = el as HTMLElement
      const cs = window.getComputedStyle(e)
      return {
        text: (e.textContent ?? '').slice(0, 40),
        active: e.dataset.active === 'true',
        adjacent: e.dataset.adjacent === 'true',
        opacity: cs.opacity,
      }
    })
  })

  console.log(`[sentence-tiers] ${tiers.length} sentences detected`)
  for (const t of tiers.slice(0, 12)) {
    console.log(
      `  - active=${t.active ? 'Y' : '·'} adjacent=${t.adjacent ? 'Y' : '·'} opacity=${t.opacity}  "${t.text}…"`,
    )
  }

  const activeCount = tiers.filter((t) => t.active).length
  const adjacentCount = tiers.filter((t) => t.adjacent).length
  const baseCount = tiers.filter((t) => !t.active && !t.adjacent).length

  console.log(`[summary] active=${activeCount} adjacent=${adjacentCount} base=${baseCount}`)

  // Sanity asserts — describe the failure when it happens.
  expect(activeCount, 'exactly one active sentence').toBe(1)
  expect(adjacentCount, 'one or two adjacent sentences').toBeGreaterThanOrEqual(1)

  // Pull the opacity for one of each kind.
  const active = tiers.find((t) => t.active)
  const adjacent = tiers.find((t) => t.adjacent && !t.active)
  const base = tiers.find((t) => !t.active && !t.adjacent)
  console.log(
    `[opacities] active=${active?.opacity} adjacent=${adjacent?.opacity} base=${base?.opacity}`,
  )

  if (active) expect(parseFloat(active.opacity)).toBeCloseTo(1.0, 1)
  if (adjacent) expect(parseFloat(adjacent.opacity)).toBeCloseTo(0.85, 1)
  if (base) expect(parseFloat(base.opacity)).toBeCloseTo(0.55, 1)

  // Visual capture of what the user sees.
  await page.screenshot({ path: 'tests/diagnostic/sentence-focus-edit.png', fullPage: false })
})
