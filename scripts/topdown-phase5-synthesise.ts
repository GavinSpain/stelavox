/**
 * Top-down rebuild — Phase 5: synthesise prose for Scene 1's beats.
 *
 * Each beat has a cascading word_count_target (150w each for the 4 beats
 * in Scene 1 "The Iron Ghost"). Tests whether the synthesise agent honours
 * the cascaded budget now that:
 *  - word_count_target is visible on `<current_node>` (Mig 060)
 *  - Migration 057 hierarchy says primary target is the beat summary
 *  - Migration 056 anti-bloat rules apply
 *  - Migration 054 preceding/succeeding-sibling context active
 *
 * Output: docs/topdown/phase5-prose.json with all 4 beats' prose + cost.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'
const DOCUMENT_ID = '73adfca9-f635-44ef-b07e-668d9896e3ca'
const PROJECT_ID = 'e0a79d7d-3bb8-4522-9616-be4119743372'
const PROBE = "synthesise prose for all beats in Scene 1 'The Iron Ghost'"
const OUT_DIR = resolve(__dirname, '../docs/topdown')

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function extractTiptapText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') {
    try {
      return extractTiptapText(JSON.parse(value))
    } catch {
      return value
    }
  }
  if (typeof value !== 'object') return ''
  const out: string[] = []
  function walk(n: unknown, isBlock: boolean): void {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; content?: unknown[] }
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach((c) => walk(c, false))
    if (isBlock) out.push('\n\n')
  }
  if (Array.isArray((value as { content?: unknown[] }).content)) {
    for (const block of (value as { content: unknown[] }).content) walk(block, true)
  } else {
    walk(value, false)
  }
  return out.join('').trim()
}

async function driveDirectorTurn(page: Page, probe: string): Promise<string> {
  await page.goto(`${APP_URL}/projects/${PROJECT_ID}/documents/${DOCUMENT_ID}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: 'Director' }).click()
  const panel = page.getByRole('complementary', { name: 'Director' })
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  const input = panel.getByRole('textbox')
  await input.fill(probe)
  const sent = new Date()
  await input.press('Enter')
  console.log(`[phase5] probe sent`)
  const db = admin()
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const { data: conv } = await db
      .from('conversations')
      .select('id')
      .eq('document_id', DOCUMENT_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (conv) {
      const { data: msgs } = await db
        .from('conversation_messages')
        .select('workflow_id')
        .eq('conversation_id', conv.id)
        .eq('role', 'assistant')
        .eq('turn_state', 'final')
        .gt('created_at', sent.toISOString())
        .order('sequence', { ascending: false })
        .limit(1)
      if (msgs && msgs[0]?.workflow_id) return msgs[0].workflow_id as string
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('director turn did not complete')
}

async function approveAndWait(page: Page, workflowId: string): Promise<void> {
  const res = await page.request.post(
    `${APP_URL}/api/director/workflows/${workflowId}/approve`,
    { data: {} },
  )
  if (!res.ok()) throw new Error(`approve failed: ${res.status()} ${await res.text()}`)
  console.log(`[phase5] approved ${workflowId}`)
  const db = admin()
  const deadline = Date.now() + 15 * 60_000
  while (Date.now() < deadline) {
    const { data: steps } = await db
      .from('workflow_steps')
      .select('status')
      .eq('workflow_id', workflowId)
    const pending = (steps ?? []).filter((s) =>
      ['pending', 'ready', 'running'].includes(s.status),
    ).length
    const total = steps?.length ?? 0
    console.log(`[phase5] ${total - pending}/${total} steps done`)
    if (pending === 0 && total > 0) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workflow did not complete')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Reset password.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((x) => x.email === AUTHOR_EMAIL)
  if (u) await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })

  // Clear conversations.
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('document_id', DOCUMENT_ID)
  const convIds = (convs ?? []).map((c) => c.id)
  if (convIds.length > 0) {
    await db.from('workflows').delete().in('conversation_id', convIds)
    await db.from('conversations').delete().in('id', convIds)
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', AUTHOR_EMAIL)
    await page.fill('input[type="password"]', AUTHOR_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    const workflowId = await driveDirectorTurn(page, PROBE)
    console.log(`[phase5] workflow proposed: ${workflowId}`)

    await approveAndWait(page, workflowId)

    const { data: steps } = await db
      .from('workflow_steps')
      .select('order, target_node_id, agent_job_id')
      .eq('workflow_id', workflowId)
      .order('order')

    const beats: Array<Record<string, unknown>> = []
    let totalCost = 0
    let totalIn = 0
    let totalOut = 0
    for (const s of steps ?? []) {
      const { data: node } = await db
        .from('nodes')
        .select('id, name, prose, word_count_target, summary')
        .eq('id', s.target_node_id as string)
        .maybeSingle()
      const { data: job } = await db
        .from('agent_jobs')
        .select('tokens_input, tokens_output, cost_usd')
        .eq('id', s.agent_job_id as string)
        .maybeSingle()
      const prose = extractTiptapText(node?.prose)
      const wc = prose ? prose.trim().split(/\s+/).filter(Boolean).length : 0
      totalCost += (job?.cost_usd as number | null) ?? 0
      totalIn += (job?.tokens_input as number | null) ?? 0
      totalOut += (job?.tokens_output as number | null) ?? 0
      beats.push({
        order: s.order,
        beat_id: node?.id,
        beat_name: node?.name,
        word_count_target: node?.word_count_target,
        summary_text: extractTiptapText(node?.summary),
        prose,
        prose_word_count: wc,
        tokens_input: job?.tokens_input,
        tokens_output: job?.tokens_output,
        cost_usd: job?.cost_usd,
      })
    }

    const targetSum = beats.reduce((acc, b) => acc + ((b.word_count_target as number | null) ?? 0), 0)
    const proseSum = beats.reduce((acc, b) => acc + (b.prose_word_count as number), 0)

    const out = {
      phase: 5,
      target: 'Scene 1 → synthesise',
      workflow_id: workflowId,
      synth_cost_usd: totalCost,
      total_input_tokens: totalIn,
      total_output_tokens: totalOut,
      duration_s: (Date.now() - t0) / 1000,
      target_sum: targetSum,
      prose_sum: proseSum,
      budget_compliance_pct: targetSum ? (proseSum / targetSum * 100).toFixed(1) : null,
      beats,
    }
    writeFileSync(resolve(OUT_DIR, 'phase5-prose.json'), JSON.stringify(out, null, 2))
    console.log(`[phase5] saved → ${resolve(OUT_DIR, 'phase5-prose.json')}`)
    console.log(
      `[phase5] beats=${out.beats.length} target_sum=${targetSum}w prose_sum=${proseSum}w ` +
        `compliance=${out.budget_compliance_pct}% cost=$${out.synth_cost_usd.toFixed(4)} ` +
        `dur=${out.duration_s.toFixed(0)}s`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[phase5] fatal:', e)
  process.exit(1)
})
