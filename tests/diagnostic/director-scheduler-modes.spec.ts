/**
 * Diagnostic: drive a real browser through the Director and Scheduler
 * mode buttons and capture any runtime errors. Console + page errors +
 * network failures all surface.
 *
 * Run: npx playwright test tests/diagnostic/director-scheduler-modes.spec.ts --headed --reporter=list --workers=1 --retries=0
 */

import { test, expect } from '@playwright/test'

const APP_URL = 'http://localhost:3000'
const EMAIL = 'author@stelavox.local'
const PASSWORD = 'Test1234!Test1234!'

interface Capture {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: Array<{ url: string; status: number; statusText: string }>
}

function attachCaptures(page: import('@playwright/test').Page): Capture {
  const cap: Capture = { consoleErrors: [], pageErrors: [], failedRequests: [] }
  page.on('console', (msg) => {
    if (msg.type() === 'error') cap.consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    cap.pageErrors.push(`${err.name}: ${err.message}`)
  })
  page.on('response', (resp) => {
    if (resp.status() >= 400) {
      cap.failedRequests.push({ url: resp.url(), status: resp.status(), statusText: resp.statusText() })
    }
  })
  return cap
}

test('Director and Scheduler modes load without runtime errors', async ({ page }) => {
  test.setTimeout(120000)
  const cap = attachCaptures(page)

  // ─── Sign in ───
  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', EMAIL)
  await page.fill('input[type="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/dashboard|\/projects/, { timeout: 20000 })

  // ─── Go to a known document ───
  const projectId = '084fa459-946e-4288-ac28-30e687962ee6'
  const documentId = '637acf44-38ab-42ad-b179-1d57844014b5'
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  console.log(`[edit-mode] URL=${page.url()}`)
  await page.screenshot({ path: 'tests/diagnostic/edit-mode.png', fullPage: false })

  // Snapshot captures before mode switch.
  const editConsole = [...cap.consoleErrors]
  const editPageErrors = [...cap.pageErrors]
  console.log(`[edit-mode] consoleErrors=${editConsole.length} pageErrors=${editPageErrors.length}`)
  if (editConsole.length) console.log(`[edit-mode] console:`, editConsole)
  if (editPageErrors.length) console.log(`[edit-mode] page:`, editPageErrors)

  // ─── Click Director tab ───
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}/director`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  console.log(`[director] URL=${page.url()}`)
  await page.screenshot({ path: 'tests/diagnostic/director-mode.png', fullPage: false })

  const directorConsole = cap.consoleErrors.slice(editConsole.length)
  const directorPageErrors = cap.pageErrors.slice(editPageErrors.length)
  const directorFailedReqs = cap.failedRequests.filter((r) => r.url.includes('/director'))
  console.log(`[director] consoleErrors=${directorConsole.length} pageErrors=${directorPageErrors.length}`)
  if (directorConsole.length) console.log(`[director] console:`, directorConsole)
  if (directorPageErrors.length) console.log(`[director] page:`, directorPageErrors)
  if (directorFailedReqs.length) console.log(`[director] failed:`, directorFailedReqs)

  // ─── Click Scheduler tab ───
  const beforeSchedConsole = cap.consoleErrors.length
  const beforeSchedPage = cap.pageErrors.length
  await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}/scheduler`)
  await page.waitForLoadState('networkidle', { timeout: 30000 })
  console.log(`[scheduler] URL=${page.url()}`)
  await page.screenshot({ path: 'tests/diagnostic/scheduler-mode.png', fullPage: false })

  const schedulerConsole = cap.consoleErrors.slice(beforeSchedConsole)
  const schedulerPageErrors = cap.pageErrors.slice(beforeSchedPage)
  const schedulerFailedReqs = cap.failedRequests.filter((r) => r.url.includes('/scheduler'))
  console.log(`[scheduler] consoleErrors=${schedulerConsole.length} pageErrors=${schedulerPageErrors.length}`)
  if (schedulerConsole.length) console.log(`[scheduler] console:`, schedulerConsole)
  if (schedulerPageErrors.length) console.log(`[scheduler] page:`, schedulerPageErrors)
  if (schedulerFailedReqs.length) console.log(`[scheduler] failed:`, schedulerFailedReqs)

  // Final summary
  console.log(`\n[SUMMARY]`)
  console.log(`  edit:      console=${editConsole.length}      page=${editPageErrors.length}`)
  console.log(`  director:  console=${directorConsole.length}  page=${directorPageErrors.length}`)
  console.log(`  scheduler: console=${schedulerConsole.length} page=${schedulerPageErrors.length}`)

  // Assert: zero runtime errors on either mode switch.
  expect(directorPageErrors, 'Director mode page errors').toEqual([])
  expect(schedulerPageErrors, 'Scheduler mode page errors').toEqual([])
})
