/**
 * Detailed axe probe — dumps every violation with target + html for triage.
 */
import { chromium, type Page } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import { createClient } from '@supabase/supabase-js'

const APP_URL = 'http://localhost:3000'
const SUPABASE_URL = 'http://127.0.0.1:54331'
const TEST_USER_EMAIL = 'test-a@example.com'
const TEST_USER_PASSWORD = 'Test1234!Test1234!'

async function login(page: Page): Promise<void> {
  await page.goto(`${APP_URL}/login`, { waitUntil: 'networkidle', timeout: 90_000 })
  await page.locator('input[type="email"]').click()
  await page.keyboard.type(TEST_USER_EMAIL, { delay: 5 })
  await page.locator('input[type="password"]').click()
  await page.keyboard.type(TEST_USER_PASSWORD, { delay: 5 })
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 60_000 })
}

async function dump(page: Page, surfaceName: string) {
  console.log(`\n--- ${surfaceName} ---`)
  await page.waitForLoadState('networkidle').catch(() => {})
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  for (const v of results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')) {
    console.log(`\n${v.id} (${v.impact}, ${v.nodes.length}x) — ${v.help}`)
    for (let i = 0; i < Math.min(v.nodes.length, 3); i++) {
      const n = v.nodes[i]
      console.log(`  [${i}] target: ${n.target.join(' ')}`)
      console.log(`  [${i}] html: ${n.html.slice(0, 200)}`)
      const fs = (n.failureSummary ?? '').replace(/\n+/g, ' | ')
      console.log(`  [${i}] msg: ${fs.slice(0, 200)}`)
    }
  }
}

async function main() {
  const anon = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
  const { data } = await anon.auth.signInWithPassword({ email: TEST_USER_EMAIL, password: TEST_USER_PASSWORD })
  const url = new URL(SUPABASE_URL)
  const projectRef = url.hostname.split('.')[0]
  const cookieName = `sb-${projectRef}-auth-token`
  const payload = {
    access_token: data.session!.access_token, token_type: 'bearer',
    expires_in: data.session!.expires_in, expires_at: data.session!.expires_at,
    refresh_token: data.session!.refresh_token, user: data.user,
  }
  const cookie = `${cookieName}=base64-${Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64')}`
  const apiReq = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${APP_URL}${path}`, {
      method, headers: { 'content-type': 'application/json', cookie },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, body: (await res.json().catch(() => null)) as unknown }
  }
  const ts = Date.now()
  const proj = await apiReq('POST', '/api/projects', { name: `step4-probe-${ts}` })
  const projectId = (proj.body as { project: { id: string } }).project.id
  const doc = await apiReq('POST', `/api/projects/${projectId}/documents`, { name: 'Probe Doc', document_type: 'novel' })
  const documentId = (doc.body as { document: { id: string } }).document.id
  const tree = await apiReq('GET', `/api/documents/${documentId}/nodes`)
  const rootId = (tree.body as { nodes: Array<{ id: string }> }).nodes[0].id
  async function child(parentId: string, name: string, node_type: string): Promise<string> {
    const r = await apiReq('POST', `/api/documents/${documentId}/nodes`, { parent_id: parentId, name, node_type })
    return (r.body as { node: { id: string } }).node.id
  }
  const actId = await child(rootId, 'Act', 'act')
  const chapterId = await child(actId, 'Chapter', 'chapter')
  const sceneId = await child(chapterId, 'Scene', 'scene')
  await child(sceneId, 'Beat', 'beat')

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await login(page)
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`, { waitUntil: 'networkidle', timeout: 90_000 })
    const beatRow = page.locator('[role="treeitem"]', { has: page.locator('text=Beat') }).first()
    await beatRow.waitFor({ timeout: 15_000 })
    await beatRow.click()
    await page.waitForSelector('[data-editor="summary"]', { timeout: 15_000 })
    await dump(page, 'Content tab on selected beat')
    await page.click('text=Agent', { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(500)
    await dump(page, 'Agent tab')
    await page.click('text=Comments', { timeout: 5_000 }).catch(() => {})
    await page.waitForTimeout(500)
    await dump(page, 'Comments tab')
  } finally {
    await browser.close()
  }
}

void main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
