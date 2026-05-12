/**
 * Step 1 — Opus 4.7 on existing (over-stuffed) Chapter-1 Scene-1 beats.
 *
 * Isolation experiment: hold the beat summaries constant, vary only the
 * synthesise model. Tells us whether a stronger model interprets the
 * current prompts with better discipline on the same over-stuffed content.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 npx tsx scripts/ab-step1-opus-on-existing.ts
 *
 * Restores synthesise_beat.model_id back to Haiku 4.5 at the end of the run.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'
const DOCUMENT_ID = '73adfca9-f635-44ef-b07e-668d9896e3ca'
const PROJECT_ID = 'e0a79d7d-3bb8-4522-9616-be4119743372'
const SYNTH_PROFILE_ID = 'bc494976-5e80-4d03-b5e3-6e552e0cd734'
const HAIKU = 'claude-haiku-4-5-20251001'
const OPUS = 'claude-opus-4-7'
const PROBE = 'synthesise prose for all the beats in the first scene of chapter 1'
const OUT_DIR = resolve(__dirname, '../docs/ab-opus')

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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Reset password defensively, switch synth profile to Opus.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((x) => x.email === AUTHOR_EMAIL)
  if (u) await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })
  await db.from('agent_profiles').update({ model_id: OPUS }).eq('id', SYNTH_PROFILE_ID)
  console.log(`[step1] synthesise_beat → ${OPUS}`)

  // Reset Scene 1's beat prose + clear conversations.
  await db
    .from('nodes')
    .update({ prose: null })
    .eq('document_id', DOCUMENT_ID)
    .eq('layer_index', 4)
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('document_id', DOCUMENT_ID)
  const convIds = (convs ?? []).map((c) => c.id)
  if (convIds.length > 0) {
    await db.from('workflows').delete().in('conversation_id', convIds)
    await db.from('conversations').delete().in('id', convIds)
  }
  console.log('[step1] reset prose + conversations')

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', AUTHOR_EMAIL)
    await page.fill('input[type="password"]', AUTHOR_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    await page.goto(`${APP_URL}/projects/${PROJECT_ID}/documents/${DOCUMENT_ID}`)
    await page.waitForLoadState('networkidle')
    await page.getByRole('tab', { name: 'Director' }).click()
    const panel = page.getByRole('complementary', { name: 'Director' })
    await panel.waitFor({ state: 'visible', timeout: 5000 })
    const input = panel.getByRole('textbox')
    await input.fill(PROBE)
    const sent = new Date()
    await input.press('Enter')
    console.log('[step1] probe sent')

    // Poll for Director turn completion.
    const deadline1 = Date.now() + 5 * 60_000
    let workflowId: string | null = null
    while (Date.now() < deadline1) {
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
        if (msgs && msgs[0]?.workflow_id) {
          workflowId = msgs[0].workflow_id as string
          break
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }
    if (!workflowId) throw new Error('director did not propose workflow within 5min')
    console.log(`[step1] workflow proposed: ${workflowId}`)

    // Approve.
    const res = await page.request.post(
      `${APP_URL}/api/director/workflows/${workflowId}/approve`,
      { data: {} },
    )
    if (!res.ok()) throw new Error(`approve failed: ${res.status()} ${await res.text()}`)
    console.log('[step1] approved')

    // Wait for completion.
    const deadline2 = Date.now() + 15 * 60_000
    while (Date.now() < deadline2) {
      const { data: steps } = await db
        .from('workflow_steps')
        .select('status')
        .eq('workflow_id', workflowId)
      const pending = (steps ?? []).filter((s) =>
        ['pending', 'ready', 'running'].includes(s.status),
      ).length
      const total = steps?.length ?? 0
      console.log(`[step1] ${total - pending}/${total} done`)
      if (pending === 0 && total > 0) break
      await new Promise((r) => setTimeout(r, 5000))
    }

    // Gather results.
    const { data: stepsFinal } = await db
      .from('workflow_steps')
      .select('order, target_node_id, agent_job_id')
      .eq('workflow_id', workflowId)
      .order('order')
    const beats: Array<Record<string, unknown>> = []
    let totalCost = 0
    let totalIn = 0
    let totalOut = 0
    for (const s of stepsFinal ?? []) {
      const { data: node } = await db
        .from('nodes')
        .select('id, name, prose')
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
        prose,
        prose_word_count: wc,
        tokens_input: job?.tokens_input,
        tokens_output: job?.tokens_output,
        cost_usd: job?.cost_usd,
      })
    }

    const out = {
      label: 'opus-on-existing-beats',
      model_id: OPUS,
      preceding_sibling_count: 2,
      succeeding_sibling_count: 1,
      workflow_id: workflowId,
      workflow_cost_usd: totalCost,
      total_input_tokens: totalIn,
      total_output_tokens: totalOut,
      duration_s: (Date.now() - t0) / 1000,
      total_words: beats.reduce((acc: number, b) => acc + (b.prose_word_count as number), 0),
      beats,
    }
    writeFileSync(resolve(OUT_DIR, 'opus.json'), JSON.stringify(out, null, 2))
    console.log(`[step1] saved → ${resolve(OUT_DIR, 'opus.json')}`)
    console.log(
      `[step1] cost=$${out.workflow_cost_usd.toFixed(4)} ` +
        `tokens=${out.total_input_tokens}/${out.total_output_tokens} ` +
        `total_words=${out.total_words} dur=${out.duration_s.toFixed(0)}s`,
    )
  } finally {
    await browser.close()
    // Always restore Haiku.
    await db.from('agent_profiles').update({ model_id: HAIKU }).eq('id', SYNTH_PROFILE_ID)
    console.log(`[step1] synthesise_beat restored → ${HAIKU}`)
  }
}

main().catch(async (e) => {
  console.error('[step1] fatal:', e)
  // Safety: restore Haiku on any error path.
  try {
    await admin().from('agent_profiles').update({ model_id: HAIKU }).eq('id', SYNTH_PROFILE_ID)
  } catch {}
  process.exit(1)
})
