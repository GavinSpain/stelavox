import { chromium } from '@playwright/test'
import { loadEnv } from './helpers/env'
import { adminClient } from './helpers/db'
import { USERS, APP_URL } from './helpers/auth'

const ALL_USERS = [USERS.A, USERS.B, USERS.C]

export default async function globalSetup() {
  loadEnv()
  const admin = adminClient()

  // Delete existing test users to start clean
  const { data: existing } = await admin.auth.admin.listUsers({ perPage: 200 })
  const testEmails = new Set<string>(ALL_USERS.map(u => u.email))
  for (const user of existing?.users ?? []) {
    if (testEmails.has(user.email!)) {
      await admin.auth.admin.deleteUser(user.id)
    }
  }

  // Create fresh test users (email_confirm: true bypasses confirmation)
  for (const u of ALL_USERS) {
    const { error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { display_name: u.email.split('@')[0] },
    })
    if (error) throw new Error(`Failed to create ${u.email}: ${error.message}`)
  }

  // Brief wait for H-03 trigger (create_organisation_for_user) to complete
  await new Promise(r => setTimeout(r, 300))

  // Sign each user in via browser and persist the storage state (cookies)
  const browser = await chromium.launch()
  for (const u of ALL_USERS) {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', u.email)
    await page.fill('input[type="password"]', u.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
    await ctx.storageState({ path: u.storageState })
    await ctx.close()
  }
  await browser.close()
}
