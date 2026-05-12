/**
 * Top-down rebuild — Phase 4: Scene 1 → beats.
 *
 * Asks the Director to expand Scene 1 ("The Iron Ghost", 600w budget)
 * into beats. With Migration 062's planning preamble and the cascading
 * budget, expect 3-5 beats summing to ~600w.
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
const PROBE = "expand Scene 1 of Chapter 1 'The Iron Ghost' into beats"
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
  console.log(`[phase4] probe sent`)
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
  console.log(`[phase4] approved ${workflowId}`)
  const db = admin()
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const { data: steps } = await db
      .from('workflow_steps')
      .select('status')
      .eq('workflow_id', workflowId)
    const pending = (steps ?? []).filter((s) =>
      ['pending', 'ready', 'running'].includes(s.status),
    ).length
    const total = steps?.length ?? 0
    console.log(`[phase4] ${total - pending}/${total} steps done`)
    if (pending === 0 && total > 0) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workflow did not complete')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Find Scene 1 of Chapter 1 of Act 1.
  const { data: act1Rows } = await db
    .from('nodes')
    .select('id, "order"')
    .eq('document_id', DOCUMENT_ID)
    .eq('node_type', 'act')
    .order('order')
  const act1 = (act1Rows ?? [])[0] as { id: string } | undefined
  if (!act1) throw new Error('Act 1 not found')
  const { data: ch1Rows } = await db
    .from('nodes')
    .select('id, "order"')
    .eq('parent_id', act1.id)
    .order('order')
  const ch1 = (ch1Rows ?? [])[0] as { id: string } | undefined
  if (!ch1) throw new Error('Chapter 1 not found')
  const { data: sc1Rows } = await db
    .from('nodes')
    .select('id, name, "order", word_count_target')
    .eq('parent_id', ch1.id)
    .order('order')
  const sc1 = (sc1Rows ?? [])[0] as { id: string; name: string; word_count_target: number | null } | undefined
  if (!sc1) throw new Error('Scene 1 not found')
  console.log(`[phase4] Scene 1: ${sc1.id} (${sc1.name}, budget ${sc1.word_count_target}w)`)

  // Reset password defensively.
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
    console.log(`[phase4] workflow proposed: ${workflowId}`)

    const { data: wf } = await db
      .from('workflows')
      .select('title, description')
      .eq('id', workflowId)
      .maybeSingle()
    console.log(`[phase4] workflow title: ${wf?.title}`)

    await approveAndWait(page, workflowId)

    const { data: beats } = await db
      .from('nodes')
      .select('id, name, "order", word_count_target, summary, metadata, short_description')
      .eq('parent_id', sc1.id)
      .order('order')

    const sum = (beats ?? []).reduce((acc, b) => acc + (b.word_count_target ?? 0), 0)

    const out = {
      phase: 4,
      target: 'Scene 1 → beats',
      scene_id: sc1.id,
      scene_name: sc1.name,
      scene_budget: sc1.word_count_target,
      workflow_id: workflowId,
      workflow_title: wf?.title,
      duration_s: (Date.now() - t0) / 1000,
      new_beat_count: beats?.length ?? 0,
      beat_budget_sum: sum,
      budget_compliance_pct: sc1.word_count_target ? (sum / sc1.word_count_target * 100).toFixed(1) : null,
      beats: (beats ?? []).map((b) => {
        const summaryText = extractTiptapText(b.summary)
        return {
          order: b.order,
          name: b.name,
          short_description: b.short_description,
          word_count_target: b.word_count_target,
          summary_text: summaryText,
          summary_word_count: summaryText.trim().split(/\s+/).filter(Boolean).length,
          metadata: b.metadata,
        }
      }),
    }
    writeFileSync(resolve(OUT_DIR, 'phase4-beats.json'), JSON.stringify(out, null, 2))
    console.log(`[phase4] saved → ${resolve(OUT_DIR, 'phase4-beats.json')}`)
    console.log(
      `[phase4] beats=${out.new_beat_count} budget_sum=${out.beat_budget_sum}w ` +
        `(target ${sc1.word_count_target}w, ${out.budget_compliance_pct}%) ` +
        `dur=${out.duration_s.toFixed(0)}s`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[phase4] fatal:', e)
  process.exit(1)
})
