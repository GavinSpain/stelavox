/**
 * A/B test the preceding_sibling_count parameter on the synthesise_beat
 * profile against the same fixture (Shadow Protocol, Chapter 1 Scene 1).
 *
 * Usage:
 *   APP_URL=http://localhost:3000 npx tsx scripts/ab-preceding-siblings.ts <N> [<N>...]
 *
 * For each N supplied:
 *   1. UPDATE synthesise_beat.context_rules.preceding_sibling_count = N
 *   2. Reset Scene 1's 6 beats: nodes.prose -> NULL
 *   3. Clear Shadow Protocol conversations + workflows
 *   4. Drive the Director via Playwright with the synthesise probe
 *   5. Approve the resulting workflow via the API
 *   6. Wait for all agent_jobs to complete
 *   7. Save resulting prose to docs/ab-preceding-siblings/n<N>.json
 *
 * After all runs complete, prints a side-by-side index of where each
 * run's prose lives + cost rollups so an editor can compare.
 *
 * One-off harness — delete once the count parameter is tuned.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium, type BrowserContext } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'
const DOCUMENT_ID = '73adfca9-f635-44ef-b07e-668d9896e3ca'
const PROJECT_ID = 'e0a79d7d-3bb8-4522-9616-be4119743372'
const PROBE = 'synthesise prose for all the beats in the first scene of chapter 1'
const SYNTH_PROFILE_ID = 'bc494976-5e80-4d03-b5e3-6e552e0cd734'
const OUT_DIR = resolve(__dirname, '../docs/ab-preceding-siblings')

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

interface BeatProse {
  order: number
  beat_id: string
  beat_name: string
  prose: string | null
  prose_word_count: number
  tokens_input: number | null
  tokens_output: number | null
  tokens_cache_read: number | null
  tokens_cache_write: number | null
  cost_usd: number | null
  preceding_siblings_block_len: number
  preceding_siblings_names: string[]
}

interface RunResult {
  preceding_sibling_count: number
  workflow_id: string
  workflow_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
  duration_s: number
  beats: BeatProse[]
}

async function login(ctx: BrowserContext): Promise<void> {
  const page = await ctx.newPage()
  await page.goto(`${APP_URL}/login`)
  await page.fill('input[type="email"]', AUTHOR_EMAIL)
  await page.fill('input[type="password"]', AUTHOR_PASSWORD)
  await page.click('button[type="submit"]')
  await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
  await page.close()
}

async function resetPassword() {
  const db = admin()
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((u) => u.email === AUTHOR_EMAIL)
  if (!u) throw new Error('author user not found')
  await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })
}

async function setPrecedingSiblingCount(n: number) {
  const db = admin()
  const { error } = await db
    .from('agent_profiles')
    .update({
      context_rules: { preceding_sibling_count: n },
    })
    .eq('id', SYNTH_PROFILE_ID)
  if (error) throw new Error(`set count failed: ${error.message}`)
}

async function resetBeatProse() {
  const db = admin()
  await db
    .from('nodes')
    .update({ prose: null })
    .eq('document_id', DOCUMENT_ID)
    .eq('layer_index', 4)
}

async function resetConversations() {
  const db = admin()
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

async function driveDirectorTurn(ctx: BrowserContext): Promise<string> {
  const page = await ctx.newPage()
  await page.goto(`${APP_URL}/projects/${PROJECT_ID}/documents/${DOCUMENT_ID}`)
  await page.waitForLoadState('networkidle')
  await page.getByRole('tab', { name: 'Director' }).click()
  const panel = page.getByRole('complementary', { name: 'Director' })
  await panel.waitFor({ state: 'visible', timeout: 5000 })
  const input = panel.getByRole('textbox')
  await input.fill(PROBE)
  const sent = new Date()
  await input.press('Enter')

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
      if (msgs && msgs[0]?.workflow_id) {
        await page.close()
        return msgs[0].workflow_id as string
      }
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  await page.close()
  throw new Error('director turn did not complete within 5min')
}

async function approveWorkflow(ctx: BrowserContext, workflowId: string) {
  const page = await ctx.newPage()
  const res = await page.request.post(
    `${APP_URL}/api/director/workflows/${workflowId}/approve`,
    { data: {} },
  )
  if (!res.ok()) {
    const body = await res.text()
    throw new Error(`approve failed: ${res.status()} ${body}`)
  }
  await page.close()
}

async function waitForWorkflowCompletion(workflowId: string): Promise<void> {
  const db = admin()
  const deadline = Date.now() + 5 * 60_000
  while (Date.now() < deadline) {
    const { data: steps } = await db
      .from('workflow_steps')
      .select('status')
      .eq('workflow_id', workflowId)
    const counts = (steps ?? []).reduce(
      (acc, s) => {
        acc[s.status] = (acc[s.status] ?? 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )
    const pending =
      (counts['pending'] ?? 0) +
      (counts['ready'] ?? 0) +
      (counts['running'] ?? 0)
    if (pending === 0 && (steps?.length ?? 0) > 0) return
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error('workflow did not complete within 5min')
}

async function gatherRunResult(
  workflowId: string,
  precedingSiblingCount: number,
  startedAt: number,
): Promise<RunResult> {
  const db = admin()
  // Steps in workflow order; each linked to its agent_job and target node.
  const { data: steps } = await db
    .from('workflow_steps')
    .select('order, agent_job_id, target_node_id')
    .eq('workflow_id', workflowId)
    .order('order')

  const beats: BeatProse[] = []
  let workflow_cost_usd = 0
  let total_input_tokens = 0
  let total_output_tokens = 0
  for (const s of steps ?? []) {
    const { data: node } = await db
      .from('nodes')
      .select('id, name, prose')
      .eq('id', s.target_node_id as string)
      .maybeSingle()
    const { data: job } = await db
      .from('agent_jobs')
      .select('tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_usd, context_snapshot')
      .eq('id', s.agent_job_id as string)
      .maybeSingle()
    const ps = ((job?.context_snapshot as Record<string, unknown> | null)?.['dynamic'] as Record<string, unknown> | null)?.['precedingSiblings'] as string | undefined
    const psBlock = typeof ps === 'string' ? ps : ''
    const psNames = Array.from(psBlock.matchAll(/<name>([^<]+)<\/name>/g)).map((m) => m[1] ?? '')
    const proseText = ((): string | null => {
      const p = node?.prose as unknown
      if (!p) return null
      if (typeof p === 'string') {
        try {
          const parsed = JSON.parse(p)
          return extractTiptapText(parsed)
        } catch {
          return p
        }
      }
      return extractTiptapText(p)
    })()

    const cost = (job?.cost_usd as number | null) ?? 0
    const tin = (job?.tokens_input as number | null) ?? 0
    const tout = (job?.tokens_output as number | null) ?? 0
    workflow_cost_usd += cost
    total_input_tokens += tin
    total_output_tokens += tout

    beats.push({
      order: s.order as number,
      beat_id: node?.id ?? '',
      beat_name: (node?.name as string | null) ?? '',
      prose: proseText,
      prose_word_count: proseText ? proseText.trim().split(/\s+/).filter(Boolean).length : 0,
      tokens_input: tin,
      tokens_output: tout,
      tokens_cache_read: (job?.tokens_cache_read as number | null) ?? 0,
      tokens_cache_write: (job?.tokens_cache_write as number | null) ?? 0,
      cost_usd: cost,
      preceding_siblings_block_len: psBlock.length,
      preceding_siblings_names: psNames as string[],
    })
  }

  return {
    preceding_sibling_count: precedingSiblingCount,
    workflow_id: workflowId,
    workflow_cost_usd,
    total_input_tokens,
    total_output_tokens,
    duration_s: (Date.now() - startedAt) / 1000,
    beats,
  }
}

function extractTiptapText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const out: string[] = []
  const blockSep = '\n\n'
  function walk(n: unknown, isBlock: boolean): void {
    if (!n || typeof n !== 'object') return
    const node = n as { type?: string; text?: string; content?: unknown[] }
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.content)) node.content.forEach((c) => walk(c, false))
    if (isBlock) out.push(blockSep)
  }
  if (Array.isArray((value as { content?: unknown[] }).content)) {
    for (const block of (value as { content: unknown[] }).content) {
      walk(block, true)
    }
  } else {
    walk(value, false)
  }
  return out.join('').trim()
}

async function captureExistingProse(): Promise<RunResult | null> {
  // For the "save count=3 baseline before resetting" case — if the
  // most recent workflow's beats still have prose, capture them.
  const db = admin()
  const { data: wf } = await db
    .from('workflows')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!wf) return null
  const { data: steps } = await db
    .from('workflow_steps')
    .select('target_node_id')
    .eq('workflow_id', wf.id as string)
  const allHaveProse = await Promise.all(
    (steps ?? []).map(async (s) => {
      const { data: n } = await db
        .from('nodes')
        .select('prose')
        .eq('id', s.target_node_id as string)
        .maybeSingle()
      return n?.prose != null
    }),
  )
  if (allHaveProse.length === 0 || allHaveProse.some((p) => !p)) return null
  return await gatherRunResult(wf.id as string, 3, Date.now() - 60_000)
}

async function main() {
  const ns = process.argv.slice(2).map(Number).filter((n) => n >= 1 && n <= 10)
  if (ns.length === 0) {
    console.error('usage: tsx scripts/ab-preceding-siblings.ts <N> [<N>...]')
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  // Snapshot existing count=3 prose before we reset anything.
  const existing = await captureExistingProse()
  if (existing) {
    const path = resolve(OUT_DIR, `n${existing.preceding_sibling_count}.json`)
    writeFileSync(path, JSON.stringify(existing, null, 2))
    console.log(`[ab] saved existing count=${existing.preceding_sibling_count} → ${path}`)
  }

  await resetPassword()

  const browser = await chromium.launch({ headless: true })
  try {
    const ctx = await browser.newContext()
    await login(ctx)
    for (const n of ns) {
      // Skip a re-run if we already captured this count.
      if (existing && existing.preceding_sibling_count === n) {
        console.log(`[ab] count=${n} already captured — skipping`)
        continue
      }
      console.log(`\n[ab] === running count=${n} ===`)
      const t0 = Date.now()
      await setPrecedingSiblingCount(n)
      await resetBeatProse()
      await resetConversations()
      const workflowId = await driveDirectorTurn(ctx)
      console.log(`[ab] director proposed workflow ${workflowId}`)
      await approveWorkflow(ctx, workflowId)
      await waitForWorkflowCompletion(workflowId)
      const r = await gatherRunResult(workflowId, n, t0)
      const path = resolve(OUT_DIR, `n${n}.json`)
      writeFileSync(path, JSON.stringify(r, null, 2))
      console.log(
        `[ab] count=${n} workflow=${workflowId} cost=$${r.workflow_cost_usd.toFixed(4)} ` +
          `tokens=${r.total_input_tokens}/${r.total_output_tokens} dur=${r.duration_s.toFixed(0)}s ` +
          `→ ${path}`,
      )
    }
  } finally {
    await browser.close()
  }
  console.log(`\n[ab] all runs complete; results in ${OUT_DIR}`)
}

main().catch((e) => {
  console.error('[ab] fatal:', e)
  process.exit(1)
})
