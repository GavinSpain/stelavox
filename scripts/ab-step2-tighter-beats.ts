/**
 * Step 2 — Haiku synthesise on RE-EXPANDED tighter beats.
 *
 * Tests whether the new expand_scene_into_beats prompt (Migration 055)
 * produces beats with single dramatic units, and whether Haiku synthesise
 * on those tighter beats yields proportionally tighter prose.
 *
 * Flow:
 *   1. Ensure synthesise_beat is on Haiku (Step 1 should restore this).
 *   2. Delete the existing 6 beats under "The Drift" (cascades to prose
 *      and any agent_jobs referencing them get SET NULL).
 *   3. Clear Shadow Protocol conversations + workflows.
 *   4. Drive Director: "expand The Drift scene into beats".
 *   5. Approve, wait — new beats land.
 *   6. Drive Director: "synthesise prose for all beats in The Drift".
 *   7. Approve, wait — new prose lands.
 *   8. Save results (beat structures + prose) to docs/ab-tighter-expand/.
 *
 * Cost: ~$0.02 expand + ~$0.05 synthesise = ~$0.07.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 npx tsx scripts/ab-step2-tighter-beats.ts
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
const SYNTH_PROFILE_ID = 'bc494976-5e80-4d03-b5e3-6e552e0cd734'
const HAIKU = 'claude-haiku-4-5-20251001'
const OUT_DIR = resolve(__dirname, '../docs/ab-tighter-expand')

const EXPAND_PROBE = "expand the first scene of chapter 1 'The Drift' into beats"
const SYNTH_PROBE = "synthesise prose for all the beats in the first scene of chapter 1"

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
  console.log(`[step2] probe sent: ${probe.slice(0, 60)}…`)

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
  throw new Error('director turn did not complete within 5min')
}

async function approveAndWait(page: Page, workflowId: string): Promise<void> {
  const res = await page.request.post(
    `${APP_URL}/api/director/workflows/${workflowId}/approve`,
    { data: {} },
  )
  if (!res.ok()) throw new Error(`approve failed: ${res.status()} ${await res.text()}`)
  console.log(`[step2] approved ${workflowId}`)
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
    console.log(`[step2] ${total - pending}/${total} steps done`)
    if (pending === 0 && total > 0) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workflow did not complete within 15min')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Safety: ensure synth profile is Haiku.
  await db.from('agent_profiles').update({ model_id: HAIKU }).eq('id', SYNTH_PROFILE_ID)
  console.log(`[step2] synthesise_beat → ${HAIKU}`)

  // Reset author password defensively.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((x) => x.email === AUTHOR_EMAIL)
  if (u) await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })

  // Delete existing 6 beats under "The Drift". Cascades to: their prose,
  // node_versions, comments, locks, attachments. Sets NULL on
  // agent_jobs.node_id + workflow_steps.target_node_id for old jobs.
  const { data: drift } = await db
    .from('nodes')
    .select('id')
    .eq('document_id', DOCUMENT_ID)
    .eq('name', 'The Drift')
    .maybeSingle()
  if (!drift) throw new Error('The Drift scene not found')
  const { count: beatsBefore } = await db
    .from('nodes')
    .select('id', { count: 'exact', head: true })
    .eq('parent_id', drift.id)
  console.log(`[step2] deleting ${beatsBefore} existing beats under The Drift`)
  await db.from('nodes').delete().eq('parent_id', drift.id)

  // Clear conversations + their workflows.
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
    console.log('[step2] logged in')

    // Director turn 1: expand The Drift into beats.
    const expandWorkflowId = await driveDirectorTurn(page, EXPAND_PROBE)
    console.log(`[step2] expand workflow proposed: ${expandWorkflowId}`)
    await approveAndWait(page, expandWorkflowId)

    // Inspect the new beats.
    const { data: newBeats } = await db
      .from('nodes')
      .select('id, name, "order", word_count_target, summary, metadata')
      .eq('parent_id', drift.id)
      .order('order')
    console.log(`[step2] new beat count: ${newBeats?.length ?? 0}`)
    const beatSummaries = (newBeats ?? []).map((b) => {
      const sText = extractTiptapText(b.summary)
      return {
        order: b.order,
        name: b.name,
        word_count_target: b.word_count_target,
        summary_text: sText,
        summary_word_count: sText.trim().split(/\s+/).filter(Boolean).length,
        metadata: b.metadata,
      }
    })

    // Director turn 2: synthesise prose for the new beats.
    const synthWorkflowId = await driveDirectorTurn(page, SYNTH_PROBE)
    console.log(`[step2] synth workflow proposed: ${synthWorkflowId}`)
    await approveAndWait(page, synthWorkflowId)

    // Gather synthesise results.
    const { data: synthSteps } = await db
      .from('workflow_steps')
      .select('order, target_node_id, agent_job_id')
      .eq('workflow_id', synthWorkflowId)
      .order('order')

    const synthBeats: Array<Record<string, unknown>> = []
    let totalCost = 0
    let totalIn = 0
    let totalOut = 0
    for (const s of synthSteps ?? []) {
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
      synthBeats.push({
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
      label: 'haiku-on-tighter-beats',
      model_id: HAIKU,
      preceding_sibling_count: 2,
      succeeding_sibling_count: 1,
      expand_workflow_id: expandWorkflowId,
      synth_workflow_id: synthWorkflowId,
      synth_cost_usd: totalCost,
      total_input_tokens: totalIn,
      total_output_tokens: totalOut,
      duration_s: (Date.now() - t0) / 1000,
      total_words: synthBeats.reduce((acc: number, b) => acc + (b.prose_word_count as number), 0),
      new_beat_summaries: beatSummaries,
      synth_beats: synthBeats,
    }
    writeFileSync(resolve(OUT_DIR, 'haiku-tighter.json'), JSON.stringify(out, null, 2))
    console.log(`[step2] saved → ${resolve(OUT_DIR, 'haiku-tighter.json')}`)
    console.log(
      `[step2] new_beats=${newBeats?.length ?? 0} synth_cost=$${out.synth_cost_usd.toFixed(4)} ` +
        `tokens=${out.total_input_tokens}/${out.total_output_tokens} ` +
        `total_words=${out.total_words} dur=${out.duration_s.toFixed(0)}s`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[step2] fatal:', e)
  process.exit(1)
})
