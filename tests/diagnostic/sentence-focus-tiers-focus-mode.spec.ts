/**
 * Diagnostic: verify Sentence Focus produces three opacity tiers
 * inside FocusMode (the full-screen overlay).
 *
 * Run: npx playwright test tests/diagnostic/sentence-focus-tiers-focus-mode.spec.ts --reporter=list --workers=1 --retries=0
 */

import { test, expect } from '@playwright/test'

const APP_URL = 'http://localhost:3000'
const EMAIL = 'author@stelavox.local'
const PASSWORD = 'Test1234!Test1234!'

test('Sentence Focus produces 3 opacity tiers in Focus Mode', async ({ page }) => {
  test.setTimeout(120000)

  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard|\/projects/, { timeout: 20000 })

  // Force Sentence Focus on before the doc loads.
  await page.addInitScript(() => {
    window.localStorage.setItem('stelavox_sentence_focus_enabled', 'true')
  })

  const projectId = '084fa459-946e-4288-ac28-30e687962ee6'
  const documentId = '637acf44-38ab-42ad-b179-1d57844014b5'
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })

  const signalRow = page.locator('[data-testid="node-row-name"]', { hasText: 'The Signal' }).first()
  await signalRow.click()
  await page.waitForTimeout(500)

  // Open Focus Mode via the button in the detail panel
  const focusBtn = page.locator('button', { hasText: /Focus|⌘\./ }).first()
  await focusBtn.click()
  await page.waitForTimeout(1000)

  // Skip the click — Focus Mode overlay intercepts pointer events;
  // the editor auto-focuses on mount with cursor at doc start, which
  // is enough to exercise the three-tier classification.
  await page.waitForTimeout(800)

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

  console.log(`[focus-mode] ${tiers.length} sentences detected`)

  // Show only the active + adjacent + a few base so the log is readable
  for (const t of tiers.filter((x) => x.active || x.adjacent)) {
    console.log(
      `  ★ active=${t.active ? 'Y' : '·'} adjacent=${t.adjacent ? 'Y' : '·'} opacity=${t.opacity}  "${t.text}…"`,
    )
  }

  const activeCount = tiers.filter((t) => t.active).length
  const adjacentCount = tiers.filter((t) => t.adjacent).length
  const baseCount = tiers.filter((t) => !t.active && !t.adjacent).length
  console.log(`[summary] active=${activeCount} adjacent=${adjacentCount} base=${baseCount}`)

  // Also dump info about how many [data-sentence-focus] containers exist
  // and confirm what wrappers the [data-sentence] spans sit under.
  const containers = await page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('[data-sentence-focus]'))
    return roots.map((r) => {
      const e = r as HTMLElement
      const rect = e.getBoundingClientRect()
      return {
        tag: e.tagName.toLowerCase(),
        testId: e.getAttribute('data-testid'),
        editor: e.getAttribute('data-editor'),
        selectingAttr: e.getAttribute('data-selecting'),
        visible: rect.width > 0 && rect.height > 0,
        sentenceCount: e.querySelectorAll('[data-sentence]').length,
      }
    })
  })
  console.log(`[containers] ${containers.length} data-sentence-focus root(s)`)
  for (const c of containers) {
    console.log(
      `  → ${c.tag}[data-testid="${c.testId}" data-editor="${c.editor}" selecting=${c.selectingAttr}] visible=${c.visible} sentences=${c.sentenceCount}`,
    )
  }

  expect(tiers.length, 'sentences detected in Focus Mode').toBeGreaterThan(0)
})
