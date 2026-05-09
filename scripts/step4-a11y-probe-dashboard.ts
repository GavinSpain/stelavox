/**
 * Detailed axe probe — dashboard color-contrast violations.
 * Prints each failing element with its colors so we know what to fix.
 */
import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'

const APP_URL = 'http://localhost:3000'
const TEST_USER_EMAIL = 'test-a@example.com'
const TEST_USER_PASSWORD = 'Test1234!Test1234!'

async function main() {
  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    page.on('console', (msg) => console.log(`[browser ${msg.type()}]`, msg.text()))
    page.on('pageerror', (err) => console.log('[browser error]', err.message))
    page.on('requestfailed', (r) => console.log('[req failed]', r.url(), r.failure()?.errorText))
    page.on('response', async (r) => { if (!r.ok() && r.url().includes('auth')) console.log('[auth resp]', r.status(), r.url(), await r.text().catch(() => '')) })
    await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle', timeout: 90_000 })
    await page.waitForFunction(() => document.querySelector('input[type="email"]') !== null && (window as Window & { React?: unknown }).React !== undefined || true, { timeout: 5000 }).catch(() => {})
    await page.locator('input[type="email"]').click()
    await page.keyboard.type(TEST_USER_EMAIL, { delay: 5 })
    await page.locator('input[type="password"]').click()
    await page.keyboard.type(TEST_USER_PASSWORD, { delay: 5 })
    await page.click('button[type="submit"]')
    try {
      await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 60_000 })
    } catch (e) {
      const url = page.url()
      const errText = await page.locator('p').filter({ hasText: 'password' }).first().textContent().catch(() => null)
      console.log('login stall - current url:', url, 'errText:', errText)
      await page.screenshot({ path: '/tmp/login-stall.png' })
      throw e
    }
    await page.waitForLoadState('networkidle').catch(() => {})

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    const cc = results.violations.filter((v) => v.id === 'color-contrast')
    for (const v of cc) {
      console.log(`\n${v.id} (${v.impact}) — ${v.help}`)
      for (const node of v.nodes) {
        console.log(`  target: ${node.target.join(' ')}`)
        console.log(`  html: ${node.html.slice(0, 200)}`)
        console.log(`  msg: ${node.failureSummary?.replace(/\n/g, ' ')}`)
      }
    }
  } finally {
    await browser.close()
  }
}

void main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
