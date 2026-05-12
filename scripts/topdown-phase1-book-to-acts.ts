/**
 * Top-down rebuild — Phase 1: book → acts.
 *
 * Deletes everything under Shadow Protocol's book root (3 acts cascade
 * to ~21 chapters cascade to ~6 scenes cascade to ~7 beats — all gone).
 * Preserves the book root, the book summary, and all context nodes.
 * Then asks the Director to re-expand the book into acts using the new
 * Mig 058 expand_book_into_acts prompt with SCOPE AND OVERLAP discipline.
 *
 * Output: docs/topdown/phase1-acts.json with the new act summaries,
 * metadata, and cost telemetry.
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
const PROBE = 'expand the book into acts'
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
  console.log(`[phase1] probe sent`)
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
  console.log(`[phase1] approved ${workflowId}`)
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
    console.log(`[phase1] ${total - pending}/${total} steps done`)
    if (pending === 0 && total > 0) return
    await new Promise((r) => setTimeout(r, 5000))
  }
  throw new Error('workflow did not complete within 10min')
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const db = admin()
  const t0 = Date.now()

  // Find book root.
  const { data: book } = await db
    .from('nodes')
    .select('id, name, summary')
    .eq('document_id', DOCUMENT_ID)
    .eq('node_type', 'book')
    .maybeSingle()
  if (!book) throw new Error('book root not found')
  console.log(`[phase1] book root: ${book.id} (${book.name})`)
  console.log(`[phase1] book summary length: ${extractTiptapText(book.summary).length}ch`)

  // Reset password defensively.
  const { data: users } = await db.auth.admin.listUsers({ perPage: 200 })
  const u = (users?.users ?? []).find((x) => x.email === AUTHOR_EMAIL)
  if (u) await db.auth.admin.updateUserById(u.id, { password: AUTHOR_PASSWORD })

  // Count current structural descendants for telemetry.
  const { count: structuralBefore } = await db
    .from('nodes')
    .select('id', { count: 'exact', head: true })
    .eq('document_id', DOCUMENT_ID)
    .eq('node_category', 'structural')
    .neq('id', book.id)
  console.log(`[phase1] deleting ${structuralBefore} structural descendants of book`)

  // Delete all structural nodes except the book root.
  // ON DELETE CASCADE on parent_id handles the tree; we can do it in
  // one DELETE because cascading from each act removes its chapters,
  // and similarly down. Simpler: delete by document_id + structural
  // category, but excluding the book root.
  await db
    .from('nodes')
    .delete()
    .eq('document_id', DOCUMENT_ID)
    .eq('node_category', 'structural')
    .neq('id', book.id)

  // Clear conversations + workflows.
  const { data: convs } = await db
    .from('conversations')
    .select('id')
    .eq('document_id', DOCUMENT_ID)
  const convIds = (convs ?? []).map((c) => c.id)
  if (convIds.length > 0) {
    await db.from('workflows').delete().in('conversation_id', convIds)
    await db.from('conversations').delete().in('id', convIds)
  }
  console.log('[phase1] reset complete; document has only book root + context nodes')

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
    console.log(`[phase1] workflow proposed: ${workflowId}`)

    // Print the workflow + step details before approving.
    const { data: wf } = await db
      .from('workflows')
      .select('title, description, impact_summary')
      .eq('id', workflowId)
      .maybeSingle()
    const { data: steps } = await db
      .from('workflow_steps')
      .select('order, operation_type, target_node_id, description, parameters')
      .eq('workflow_id', workflowId)
      .order('order')
    console.log(`[phase1] workflow title: ${wf?.title}`)
    console.log(`[phase1] step count: ${steps?.length}`)
    for (const s of steps ?? []) {
      console.log(`[phase1]   step ${s.order} ${s.operation_type}: ${(s.description as string)?.slice(0, 100)}`)
    }

    await approveAndWait(page, workflowId)

    // Gather new acts.
    const { data: acts } = await db
      .from('nodes')
      .select('id, name, "order", word_count_target, summary, metadata, short_description')
      .eq('document_id', DOCUMENT_ID)
      .eq('node_type', 'act')
      .order('order')

    const out = {
      phase: 1,
      target: 'book → acts',
      workflow_id: workflowId,
      workflow_title: wf?.title,
      duration_s: (Date.now() - t0) / 1000,
      structural_nodes_before_delete: structuralBefore,
      new_act_count: acts?.length ?? 0,
      acts: (acts ?? []).map((a) => {
        const summaryText = extractTiptapText(a.summary)
        return {
          order: a.order,
          name: a.name,
          short_description: a.short_description,
          word_count_target: a.word_count_target,
          summary_text: summaryText,
          summary_word_count: summaryText.trim().split(/\s+/).filter(Boolean).length,
          metadata: a.metadata,
        }
      }),
    }
    writeFileSync(resolve(OUT_DIR, 'phase1-acts.json'), JSON.stringify(out, null, 2))
    console.log(`[phase1] saved → ${resolve(OUT_DIR, 'phase1-acts.json')}`)
    console.log(`[phase1] new_acts=${out.new_act_count} dur=${out.duration_s.toFixed(0)}s`)
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[phase1] fatal:', e)
  process.exit(1)
})
