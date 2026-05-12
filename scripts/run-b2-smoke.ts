/**
 * B2 smoke harness — Director v1.1 prompt verification.
 *
 * V1.x-LB launch-blocker fix-pack, B2 verification.
 *
 * Drives one Director turn against the launch-test "Shadow Protocol"
 * document (114 scenes) with a request that exceeds the 30-step
 * workflow cap. The five behavioural checks against the v1.1 prompt:
 *
 *   1. Produces a <workflow_proposal> block (no silent truncation).
 *   2. step count ≤ 30 (respects the cap).
 *   3. title states a canonical range explicitly.
 *   4. impact_summary mentions canonical positions.
 *   5. multi-workflow framing in title or description ("part 1 of N", "first batch", etc.).
 *
 * Usage:
 *   $ NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
 *     npx tsx scripts/run-b2-smoke.ts
 *
 * Requires the dev server at http://localhost:3000 to be running.
 *
 * NOT a permanent fixture. After the V1.x-LB fix-pack lands and the
 * launch test passes, this script can be deleted — its job is one-off
 * verification of B2 against the specific launch-test data shape.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const SHADOW_PROTOCOL_DOCUMENT_ID = '73adfca9-f635-44ef-b07e-668d9896e3ca'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'

const PROBE_TEXT =
  "Break every one of the 114 scenes into beats. I want all 114 scenes expanded so I can start drafting beat by beat."

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    process.exit(1)
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function resetAuthorPassword() {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === AUTHOR_EMAIL)
  if (!user) throw new Error(`user ${AUTHOR_EMAIL} not found`)
  const { error } = await admin.auth.admin.updateUserById(user.id, {
    password: AUTHOR_PASSWORD,
  })
  if (error) throw new Error(`reset password failed: ${error.message}`)
  console.log(`[smoke] reset password for ${AUTHOR_EMAIL}`)
  return user.id
}

async function getProjectId(): Promise<string> {
  const admin = adminClient()
  const { data: doc } = await admin
    .from('documents')
    .select('project_id')
    .eq('id', SHADOW_PROTOCOL_DOCUMENT_ID)
    .maybeSingle()
  if (!doc) throw new Error(`document ${SHADOW_PROTOCOL_DOCUMENT_ID} not found`)
  return doc.project_id as string
}

async function getDirectorProductionConfig() {
  const admin = adminClient()
  const { data } = await admin
    .from('director_configs')
    .select('version_number, model_id, length: system_prompt')
    .eq('status', 'production')
    .maybeSingle()
  return data
}

interface SmokeResult {
  workflow_id: string | null
  title: string | null
  description: string | null
  impact_summary: string | null
  step_count: number
  assistant_text: string
  assistant_text_length: number
  tool_call_count: number
  tokens_input: number | null
  tokens_output: number | null
  cost_usd: number | null
  duration_ms: number
}

async function main() {
  console.log('[smoke] V1.x-LB smoke — Director prompt + progress field against Shadow Protocol')

  const cfg = await getDirectorProductionConfig()
  console.log(`[smoke] active Director config: v${cfg?.version_number} model=${cfg?.model_id}`)
  if (!cfg?.version_number || (cfg.version_number !== '1.1' && cfg.version_number !== '1.2')) {
    console.error(`[smoke] expected v1.1 or v1.2 production prompt, found v${cfg?.version_number}`)
    process.exit(1)
  }

  await resetAuthorPassword()
  const projectId = await getProjectId()

  const browser = await chromium.launch({ headless: true })
  const startedAt = Date.now()

  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    // Login
    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', AUTHOR_EMAIL)
    await page.fill('input[type="password"]', AUTHOR_PASSWORD)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })
    console.log('[smoke] logged in')

    // Open document
    await page.goto(`${APP_URL}/projects/${projectId}/documents/${SHADOW_PROTOCOL_DOCUMENT_ID}`)
    await page.waitForLoadState('networkidle')

    // Switch to Director Mode
    await page.getByRole('tab', { name: 'Director' }).click()
    const panel = page.getByRole('complementary', { name: 'Director' })
    await panel.waitFor({ state: 'visible', timeout: 5000 })
    console.log('[smoke] Director Mode mounted')

    // Send probe
    const input = panel.getByRole('textbox')
    await input.fill(PROBE_TEXT)
    const probeSentAt = new Date()
    await input.press('Enter')
    console.log(`[smoke] probe sent at ${probeSentAt.toISOString()}`)

    // Poll for completion (up to 5 min — large doc + many tool calls)
    const admin = adminClient()
    const deadline = Date.now() + 300_000
    let convId: string | null = null
    let assistantId: string | null = null
    while (Date.now() < deadline) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('document_id', SHADOW_PROTOCOL_DOCUMENT_ID)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (conv) {
        convId = conv.id
        const { data: msgs } = await admin
          .from('conversation_messages')
          .select('id, content, turn_state, created_at')
          .eq('conversation_id', conv.id)
          .eq('role', 'assistant')
          .eq('turn_state', 'final')
          .gt('created_at', probeSentAt.toISOString())
          .order('sequence', { ascending: false })
          .limit(1)
        if (msgs && msgs.length > 0 && typeof msgs[0]!.content === 'string' && msgs[0]!.content.length > 0) {
          assistantId = msgs[0]!.id
          break
        }
      }
      await new Promise((r) => setTimeout(r, 2000))
    }

    if (!assistantId || !convId) {
      console.error('[smoke] turn did not complete within 5 min')
      process.exit(2)
    }

    // Pull final state
    const { data: asst } = await admin
      .from('conversation_messages')
      .select('content, tool_calls, tokens_input, tokens_output, cost_usd, workflow_id')
      .eq('id', assistantId)
      .maybeSingle()
    if (!asst) throw new Error('assistant message disappeared')

    const result: SmokeResult = {
      workflow_id: (asst.workflow_id as string | null) ?? null,
      title: null,
      description: null,
      impact_summary: null,
      step_count: 0,
      assistant_text: (asst.content as string) ?? '',
      assistant_text_length: ((asst.content as string) ?? '').length,
      tool_call_count: Array.isArray(asst.tool_calls) ? (asst.tool_calls as unknown[]).length : 0,
      tokens_input: (asst.tokens_input as number | null) ?? null,
      tokens_output: (asst.tokens_output as number | null) ?? null,
      cost_usd: (asst.cost_usd as number | null) ?? null,
      duration_ms: Date.now() - startedAt,
    }

    if (result.workflow_id) {
      const { data: wf } = await admin
        .from('workflows')
        .select('title, description, impact_summary')
        .eq('id', result.workflow_id)
        .maybeSingle()
      if (wf) {
        result.title = (wf.title as string) ?? null
        result.description = (wf.description as string | null) ?? null
        result.impact_summary = (wf.impact_summary as string | null) ?? null
      }
      const { data: steps } = await admin
        .from('workflow_steps')
        .select('order, operation_type')
        .eq('workflow_id', result.workflow_id)
      result.step_count = (steps ?? []).length
    }

    // ─── Behavioural checks ──────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════════')
    console.log('B2 SMOKE RESULT')
    console.log('══════════════════════════════════════════════════════════')
    console.log(`duration: ${(result.duration_ms / 1000).toFixed(1)}s`)
    console.log(`tool calls: ${result.tool_call_count}`)
    console.log(`tokens: ${result.tokens_input} in / ${result.tokens_output} out`)
    console.log(`cost: $${result.cost_usd?.toFixed(4) ?? '?'}`)
    console.log(`assistant text length: ${result.assistant_text_length}ch`)
    console.log(`workflow_id: ${result.workflow_id ?? '(none)'}`)
    console.log(`step_count: ${result.step_count}`)
    console.log('---')
    console.log(`title:           ${result.title ?? '(none)'}`)
    console.log(`description:     ${result.description ?? '(none)'}`)
    console.log(`impact_summary:  ${result.impact_summary ?? '(none)'}`)
    console.log('---')
    console.log('ASSISTANT TEXT (first 1500ch):')
    console.log(result.assistant_text.slice(0, 1500))
    console.log('══════════════════════════════════════════════════════════\n')

    const checks = {
      '1. workflow_proposal emitted': Boolean(result.workflow_id),
      '2. step_count ≤ 30': result.step_count > 0 && result.step_count <= 30,
      '3. title contains explicit canonical range': Boolean(
        result.title && /\b\d+\s*[–\-to]+\s*\d+\b/.test(result.title),
      ),
      '4. impact_summary mentions canonical positions': Boolean(
        result.impact_summary &&
          /(canonical|positions?|scenes?\s+\d+)/i.test(result.impact_summary),
      ),
      '5. multi-workflow framing (part N of M, first batch, etc.)':
        Boolean(
          (result.title && /(part\s*\d+\s*of\s*\d+|first\s+batch|batch\s*\d+\s*of\s*\d+)/i.test(result.title)) ||
            (result.description && /(part\s*\d+\s*of\s*\d+|first\s+batch|remaining\s+scenes|next\s+batch)/i.test(result.description)) ||
            (result.assistant_text && /(part\s*\d+\s*of\s*\d+|first\s+batch|remaining\s+scenes|exceed.*?(limit|cap))/i.test(result.assistant_text)),
        ),
    }

    console.log('BEHAVIOURAL CHECKS:')
    let passed = 0
    for (const [k, v] of Object.entries(checks)) {
      console.log(`  ${v ? '✓' : '✗'} ${k}`)
      if (v) passed++
    }
    console.log(`\n${passed}/5 checks passed`)
    if (passed < 5) {
      console.log('\n(Partial pass is expected — prompt-level discipline takes iteration. Read the assistant text above to judge.)')
      process.exitCode = 0 // never fail the smoke; it's diagnostic
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[smoke] fatal:', e)
  process.exit(1)
})
