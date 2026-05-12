/**
 * Scene-variety cascade test — run the same Phase 3+4+5 cascade against
 * different scene types to validate the architecture generalises beyond
 * the quiet/atmospheric scene we used in the Phase 5 baseline.
 *
 * Usage:
 *   APP_URL=http://localhost:3000 npx tsx scripts/topdown-variety-test.ts <chapter_order>
 *
 * The script:
 *   1. Finds Chapter <chapter_order> under Act 1
 *   2. If it has no scenes yet, expands it into scenes
 *   3. Picks the scene with the highest word_count_target (likely the
 *      chapter's climactic scene) as the test subject
 *   4. Expands that scene into beats
 *   5. Synthesises prose for those beats
 *   6. Saves results to docs/variety/ch<N>-<test_label>.json
 *
 * Three test runs intended: chapters 2, 4, 5 — action, dialogue, ensemble.
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
const OUT_DIR = resolve(__dirname, '../docs/variety')

const LABELS: Record<number, string> = {
  2: 'action-the-wipe',
  4: 'dialogue-first-contact',
  5: 'ensemble-the-crew',
}

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
  console.log(`[variety] probe sent: ${probe.slice(0, 60)}…`)
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

async function approveAndWait(page: Page, workflowId: string, label: string): Promise<void> {
  const res = await page.request.post(
    `${APP_URL}/api/director/workflows/${workflowId}/approve`,
    { data: {} },
  )
  if (!res.ok()) throw new Error(`approve failed: ${res.status()} ${await res.text()}`)
  console.log(`[variety] approved ${workflowId} (${label})`)
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
    console.log(`[variety] ${label}: ${total - pending}/${total} steps done`)
    if (pending === 0 && total > 0) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workflow did not complete')
}

async function clearConversations(db: ReturnType<typeof admin>): Promise<void> {
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('document_id', DOCUMENT_ID)
  const convIds = (convs ?? []).map((c) => c.id)
  if (convIds.length > 0) {
    await db.from('workflows').delete().in('conversation_id', convIds)
    await db.from('conversations').delete().in('id', convIds)
  }
}

async function main() {
  const chapterOrder = Number(process.argv[2])
  if (!chapterOrder || !LABELS[chapterOrder]) {
    console.error(`usage: tsx scripts/topdown-variety-test.ts <2|4|5>`)
    process.exit(1)
  }
  const label = LABELS[chapterOrder]
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Find Act 1 → Chapter N.
  const { data: act1Rows } = await db
    .from('nodes')
    .select('id, "order"')
    .eq('document_id', DOCUMENT_ID)
    .eq('node_type', 'act')
    .order('order')
  const act1 = (act1Rows ?? [])[0] as { id: string } | undefined
  if (!act1) throw new Error('Act 1 not found')
  const { data: chapters } = await db
    .from('nodes')
    .select('id, name, "order", word_count_target')
    .eq('parent_id', act1.id)
    .order('order')
  const ch = (chapters ?? []).find((c) => (c as { order: number }).order === chapterOrder) as
    | { id: string; name: string; word_count_target: number | null }
    | undefined
  if (!ch) throw new Error(`Chapter ${chapterOrder} not found`)
  console.log(`[variety] target: Chapter ${chapterOrder} "${ch.name}" (budget ${ch.word_count_target}w)`)

  // Reset password.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((x) => x.email === AUTHOR_EMAIL)
  if (u) await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', AUTHOR_EMAIL)
    await page.fill('input[type="password"]', AUTHOR_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    // ── Step 1: expand Chapter → scenes ─────────────────────────────
    await clearConversations(db)
    const expandSceneWfId = await driveDirectorTurn(
      page,
      `expand Chapter ${chapterOrder} '${ch.name}' into scenes`,
    )
    await approveAndWait(page, expandSceneWfId, 'expand→scenes')
    const { data: scenes } = await db
      .from('nodes')
      .select('id, name, "order", word_count_target, summary, metadata')
      .eq('parent_id', ch.id)
      .order('order')
    console.log(`[variety] ${scenes?.length ?? 0} scenes produced for ${ch.name}`)
    // Pick highest-budget scene (likely the climactic one).
    const scenesList = scenes ?? []
    const pickedScene = scenesList.reduce(
      (best, s) =>
        (s.word_count_target ?? 0) > (best?.word_count_target ?? 0) ? s : best,
      scenesList[0] as (typeof scenesList)[number] | undefined,
    )
    if (!pickedScene) throw new Error('no scenes produced')
    console.log(
      `[variety] picked scene: ${pickedScene.name} (budget ${pickedScene.word_count_target}w)`,
    )

    // ── Step 2: expand picked Scene → beats ─────────────────────────
    await clearConversations(db)
    const expandBeatWfId = await driveDirectorTurn(
      page,
      `expand scene '${pickedScene.name}' into beats`,
    )
    await approveAndWait(page, expandBeatWfId, 'expand→beats')
    const { data: beatsRaw } = await db
      .from('nodes')
      .select('id, name, "order", word_count_target, summary, metadata')
      .eq('parent_id', pickedScene.id)
      .order('order')
    const beatsList = beatsRaw ?? []
    console.log(`[variety] ${beatsList.length} beats produced for ${pickedScene.name}`)

    // ── Step 3: synthesise prose ────────────────────────────────────
    await clearConversations(db)
    const synthWfId = await driveDirectorTurn(
      page,
      `synthesise prose for all beats in scene '${pickedScene.name}'`,
    )
    await approveAndWait(page, synthWfId, 'synthesise')

    // Gather final.
    const { data: synthSteps } = await db
      .from('workflow_steps')
      .select('order, target_node_id, agent_job_id')
      .eq('workflow_id', synthWfId)
      .order('order')
    const proseBeats: Array<Record<string, unknown>> = []
    let totalCost = 0
    let totalIn = 0
    let totalOut = 0
    for (const s of synthSteps ?? []) {
      const { data: node } = await db
        .from('nodes')
        .select('id, name, prose, word_count_target, summary, metadata')
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
      proseBeats.push({
        order: s.order,
        beat_id: node?.id,
        beat_name: node?.name,
        word_count_target: node?.word_count_target,
        summary_text: extractTiptapText(node?.summary),
        prose,
        prose_word_count: wc,
        metadata: node?.metadata,
      })
    }

    const out = {
      label,
      chapter_order: chapterOrder,
      chapter_name: ch.name,
      chapter_budget: ch.word_count_target,
      scene_count: scenesList.length,
      scenes_budget_sum: scenesList.reduce(
        (acc, s) => acc + ((s.word_count_target as number | null) ?? 0),
        0,
      ),
      picked_scene_name: pickedScene.name,
      picked_scene_budget: pickedScene.word_count_target,
      beat_count: beatsList.length,
      beats_budget_sum: beatsList.reduce(
        (acc, b) => acc + ((b.word_count_target as number | null) ?? 0),
        0,
      ),
      synth_workflow_id: synthWfId,
      synth_cost_usd: totalCost,
      total_input_tokens: totalIn,
      total_output_tokens: totalOut,
      duration_s: (Date.now() - t0) / 1000,
      target_sum: proseBeats.reduce(
        (acc, b) => acc + ((b.word_count_target as number | null) ?? 0),
        0,
      ),
      prose_sum: proseBeats.reduce((acc, b) => acc + (b.prose_word_count as number), 0),
      scenes: scenesList.map((s) => ({
        order: s.order,
        name: s.name,
        word_count_target: s.word_count_target,
        summary_text: extractTiptapText(s.summary),
      })),
      beats: proseBeats,
    }
    const outPath = resolve(OUT_DIR, `ch${chapterOrder}-${label}.json`)
    writeFileSync(outPath, JSON.stringify(out, null, 2))
    console.log(`[variety] saved → ${outPath}`)
    console.log(
      `[variety] scene_sum=${out.scenes_budget_sum}w  beat_sum=${out.beats_budget_sum}w  ` +
        `prose=${out.prose_sum}w (target ${out.target_sum}w)  cost=$${out.synth_cost_usd.toFixed(4)}  ` +
        `dur=${out.duration_s.toFixed(0)}s`,
    )
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[variety] fatal:', e)
  process.exit(1)
})
