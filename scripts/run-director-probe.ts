/**
 * Director probe runner — fully automated, no human in the loop.
 *
 * Usage:
 *   npx tsx scripts/run-director-probe.ts \
 *     --scenario j5-novel \
 *     --probe-id P-J5 \
 *     --model claude-haiku-4-5-20251001 \
 *     [--reset] \
 *     [--output results/run-haiku.json]
 *
 * Flow:
 *   1. Parse args, resolve probe text, validate model exists in price registry.
 *   2. Update director_configs.model_id to the chosen model.
 *   3. Optionally re-seed the fixture (--reset).
 *   4. Launch headless Chromium via Playwright APIs.
 *   5. Sign in test user, navigate to document, switch to Director Mode.
 *   6. Send the probe and wait for the assistant turn to complete (poll DB).
 *   7. Pull full structured result: tool calls, assistant text, workflow,
 *      workflow steps, tokens, cost.
 *   8. Write JSON to --output (default: results/<timestamp>_<probe>_<model>.json).
 *   9. Print one-line summary to stdout.
 *
 * Used by T-17 prompt iteration loops. The same script runs the cloud
 * smoke at T-18.3 with a different SUPABASE_URL.
 *
 * Spec authority: docs/stelavox_director_eval_methodology_v1_0.md §5
 * (eval cadence — pre-launch model evaluation runs the corpus).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { execSync } from 'child_process'
import { mkdirSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'

import { getProbe } from '../fixtures/director-corpus/j5-novel/probes'

// ─── Config ────────────────────────────────────────────────────────────

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'

const SCENARIO_USERS: Record<string, { email: string; password: string }> = {
  'j5-novel': { email: 'j5-walk@example.com', password: 'Test1234!Test1234!' },
}

const SCENARIO_PROJECT_NAME: Record<string, string> = {
  'j5-novel': 'j5-novel',
}

// ─── Args ──────────────────────────────────────────────────────────────

interface Args {
  scenario: string
  probeId: string
  model: string
  reset: boolean
  output: string | null
  turnTimeoutMs: number
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let scenario = ''
  let probeId = ''
  let model = ''
  let reset = false
  let output: string | null = null
  let turnTimeoutMs = 180_000

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--scenario') scenario = args[++i]
    else if (a === '--probe-id') probeId = args[++i]
    else if (a === '--model') model = args[++i]
    else if (a === '--reset') reset = true
    else if (a === '--output') output = args[++i]
    else if (a === '--turn-timeout-ms') turnTimeoutMs = Number(args[++i])
    else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/run-director-probe.ts --scenario <slug> --probe-id <id> --model <model_id> [--reset] [--output path]')
      process.exit(0)
    }
  }

  if (!scenario) fail('--scenario is required')
  if (!probeId) fail('--probe-id is required')
  if (!model) fail('--model is required')
  if (!SCENARIO_USERS[scenario]) fail(`Unknown scenario "${scenario}". Available: ${Object.keys(SCENARIO_USERS).join(', ')}`)

  return { scenario, probeId, model, reset, output, turnTimeoutMs }
}

function fail(msg: string): never {
  console.error(`error: ${msg}`)
  process.exit(1)
}

// ─── Helpers ───────────────────────────────────────────────────────────

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) fail('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function setDirectorModel(model: string) {
  const admin = adminClient()
  const { error } = await admin
    .from('director_configs')
    .update({ model_id: model })
    .eq('version_number', '1.0')
    .eq('status', 'production')
  if (error) fail(`failed to set director model: ${error.message}`)
}

async function ensurePriceRegistry(model: string) {
  const admin = adminClient()
  const { data } = await admin
    .from('platform_config')
    .select('key')
    .like('key', `price.anthropic.${model}.%`)
  const found = (data ?? []).map((r) => r.key)
  const expected = [
    `price.anthropic.${model}.input_per_mtok`,
    `price.anthropic.${model}.output_per_mtok`,
  ]
  const missing = expected.filter((k) => !found.includes(k))
  if (missing.length > 0) {
    fail(`model "${model}" is missing platform_config price entries: ${missing.join(', ')}`)
  }
}

async function reseedScenario(scenario: string) {
  console.log(`[seed] re-seeding ${scenario}...`)
  execSync(`npx tsx scripts/seed-director-fixture.ts --scenario ${scenario} --reset`, {
    cwd: resolve(__dirname, '..'),
    stdio: 'pipe',
    encoding: 'utf8',
  })
}

async function getProjectAndDocumentIds(scenario: string, email: string): Promise<{ projectId: string; documentId: string }> {
  const admin = adminClient()
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
  const user = (users?.users ?? []).find((u) => u.email === email)
  if (!user) fail(`test user "${email}" not found`)
  const { data: member } = await admin.from('organisation_members').select('organisation_id').eq('user_id', user.id).single()
  if (!member) fail(`user "${email}" has no organisation`)
  const projectName = SCENARIO_PROJECT_NAME[scenario]
  const { data: project } = await admin.from('projects').select('id').eq('organisation_id', member.organisation_id).eq('name', projectName).single()
  if (!project) fail(`project "${projectName}" not found for ${email}`)
  const { data: doc } = await admin.from('documents').select('id').eq('project_id', project.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!doc) fail(`no document found in project "${projectName}"`)
  return { projectId: project.id, documentId: doc.id }
}

// ─── Result types ──────────────────────────────────────────────────────

export interface ProbeResult {
  scenario: string
  probe_id: string
  probe_text: string
  model_id: string
  started_at: string
  finished_at: string
  duration_ms: number
  conversation_id: string
  user_message_id: string | null
  assistant_message_id: string | null
  tool_calls: Array<{ name: string; validation_result: string }>
  tool_call_count: number
  assistant_text: string
  assistant_text_length: number
  workflow: {
    id: string
    title: string
    description: string | null
    impact_summary: string | null
    estimated_total_minutes: number | null
    status: string
    locked_nodes_requiring_unlock: string[]
  } | null
  workflow_steps: Array<{
    order: number
    operation_type: string
    target_node_id: string
    description: string | null
    parameters: unknown
    status: string
  }>
  tokens_input: number | null
  tokens_output: number | null
  tokens_cache_read: number | null
  tokens_cache_write: number | null
  cost_usd: number | null
  ui_error: string | null
}

// ─── Main ──────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs()
  const probe = getProbe(args.probeId)
  const user = SCENARIO_USERS[args.scenario]
  const startedAt = new Date()

  console.log(`[probe] scenario=${args.scenario} probe=${args.probeId} model=${args.model}`)
  console.log(`[probe] text=${probe.text.slice(0, 100)}${probe.text.length > 100 ? '…' : ''}`)

  // Step 1: validate model is in price registry.
  await ensurePriceRegistry(args.model)

  // Step 2: re-seed if requested (fresh fixture for clean comparison).
  if (args.reset) {
    await reseedScenario(args.scenario)
  }

  // Step 3: set the Director model.
  await setDirectorModel(args.model)
  console.log(`[probe] director_configs.model_id ← ${args.model}`)

  // Step 4: resolve project + document IDs.
  const { projectId, documentId } = await getProjectAndDocumentIds(args.scenario, user.email)
  console.log(`[probe] project=${projectId.slice(0, 8)}… document=${documentId.slice(0, 8)}…`)

  // Step 5: launch Chromium and drive the UI.
  const browser = await chromium.launch({ headless: true })
  let uiError: string | null = null
  try {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto(`${APP_URL}/login`)
    await page.fill('input[type="email"]', user.email)
    await page.fill('input[type="password"]', user.password)
    await page.click('button[type="submit"]')
    await page.waitForURL(`${APP_URL}/dashboard`, { timeout: 15_000 })

    await page.goto(`${APP_URL}/projects/${projectId}/documents/${documentId}`)
    await page.waitForLoadState('networkidle')

    await page.getByRole('tab', { name: 'Director' }).click()
    const panel = page.getByRole('complementary', { name: 'Director' })
    await panel.waitFor({ state: 'visible', timeout: 5000 })

    const input = panel.getByRole('textbox')
    await input.fill(probe.text)
    // Capture the wall-clock instant just before sending. The polling loop
    // below filters assistant messages on `created_at > probeSentAt` so we
    // only return messages produced by THIS turn, not by any prior probe
    // that may have left a final assistant message in the same conversation
    // (the cloud-smoke run on 2026-05-08 surfaced this as a stale-message
    // false positive when probes ran sequentially without --reset).
    const probeSentAt = new Date()
    await input.press('Enter')

    // Wait for the assistant turn to complete by polling the DB.
    const admin = adminClient()
    const deadline = Date.now() + args.turnTimeoutMs
    let convId: string | null = null
    let assistantId: string | null = null
    while (Date.now() < deadline) {
      const { data: conv } = await admin
        .from('conversations')
        .select('id')
        .eq('document_id', documentId)
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
        if (msgs && msgs.length > 0 && typeof msgs[0].content === 'string' && msgs[0].content.length > 0) {
          assistantId = msgs[0].id
          break
        }
      }
      // Also poll for UI alert in case streaming errored out early.
      const alert = await panel.getByRole('alert').textContent().catch(() => null)
      if (alert && alert.includes('Director — ')) {
        uiError = alert
        break
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    if (uiError) {
      console.warn(`[probe] UI error: ${uiError}`)
    } else if (!assistantId) {
      uiError = `turn did not complete within ${args.turnTimeoutMs}ms`
      console.warn(`[probe] ${uiError}`)
    }

    // Step 6: pull final state from DB, regardless of error path.
    const result = await captureResult({
      scenario: args.scenario,
      probe,
      modelId: args.model,
      startedAt,
      conversationId: convId,
      assistantMessageId: assistantId,
      uiError,
      documentId,
    })

    // Step 7: write output.
    const outPath = args.output ?? defaultOutputPath(args, startedAt)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
    console.log(`[probe] result → ${outPath}`)
    console.log(
      `[probe] summary: tools=${result.tool_call_count} assistant=${result.assistant_text_length}ch workflow=${result.workflow ? `${result.workflow_steps.length} steps` : 'none'} tokens=${result.tokens_input}/${result.tokens_output} cost=$${result.cost_usd?.toFixed(4) ?? '?'} duration=${(result.duration_ms / 1000).toFixed(1)}s`,
    )
    if (uiError) {
      process.exitCode = 2
    }
  } finally {
    await browser.close()
  }
}

async function captureResult(params: {
  scenario: string
  probe: { id: string; text: string }
  modelId: string
  startedAt: Date
  conversationId: string | null
  assistantMessageId: string | null
  uiError: string | null
  documentId: string
}): Promise<ProbeResult> {
  const admin = adminClient()
  const finishedAt = new Date()

  let toolCalls: Array<{ name: string; validation_result: string }> = []
  let assistantText = ''
  let tokensInput: number | null = null
  let tokensOutput: number | null = null
  let tokensCacheRead: number | null = null
  let tokensCacheWrite: number | null = null
  let costUsd: number | null = null
  let userMessageId: string | null = null
  let workflow: ProbeResult['workflow'] = null
  let workflowSteps: ProbeResult['workflow_steps'] = []

  if (params.conversationId) {
    // User message
    const { data: userMsg } = await admin
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', params.conversationId)
      .eq('role', 'user')
      .order('sequence', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (userMsg) userMessageId = userMsg.id

    // Assistant message
    if (params.assistantMessageId) {
      const { data: asst } = await admin
        .from('conversation_messages')
        .select('content, tool_calls, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_usd, workflow_id')
        .eq('id', params.assistantMessageId)
        .maybeSingle()
      if (asst) {
        assistantText = (asst.content as string) ?? ''
        const tcs = Array.isArray(asst.tool_calls) ? (asst.tool_calls as Array<Record<string, unknown>>) : []
        toolCalls = tcs.map((t) => ({
          name: String(t.name ?? ''),
          validation_result: String(t.validation_result ?? ''),
        }))
        tokensInput = (asst.tokens_input as number | null) ?? null
        tokensOutput = (asst.tokens_output as number | null) ?? null
        tokensCacheRead = (asst.tokens_cache_read as number | null) ?? null
        tokensCacheWrite = (asst.tokens_cache_write as number | null) ?? null
        costUsd = (asst.cost_usd as number | null) ?? null
        const workflowId = asst.workflow_id as string | null
        if (workflowId) {
          const { data: wf } = await admin
            .from('workflows')
            .select('id, title, description, impact_summary, estimated_total_minutes, status, locked_nodes_requiring_unlock')
            .eq('id', workflowId)
            .maybeSingle()
          if (wf) {
            workflow = {
              id: wf.id,
              title: wf.title as string,
              description: (wf.description as string | null) ?? null,
              impact_summary: (wf.impact_summary as string | null) ?? null,
              estimated_total_minutes: (wf.estimated_total_minutes as number | null) ?? null,
              status: wf.status as string,
              locked_nodes_requiring_unlock: ((wf.locked_nodes_requiring_unlock as string[] | null) ?? []),
            }
          }
          const { data: steps } = await admin
            .from('workflow_steps')
            .select('order, operation_type, target_node_id, description, parameters, status')
            .eq('workflow_id', workflowId)
            .order('order', { ascending: true })
          workflowSteps = (steps ?? []).map((s) => ({
            order: s.order as number,
            operation_type: s.operation_type as string,
            target_node_id: s.target_node_id as string,
            description: (s.description as string | null) ?? null,
            parameters: s.parameters,
            status: s.status as string,
          }))
        }
      }
    }
  }

  return {
    scenario: params.scenario,
    probe_id: params.probe.id,
    probe_text: params.probe.text,
    model_id: params.modelId,
    started_at: params.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: finishedAt.getTime() - params.startedAt.getTime(),
    conversation_id: params.conversationId ?? '',
    user_message_id: userMessageId,
    assistant_message_id: params.assistantMessageId,
    tool_calls: toolCalls,
    tool_call_count: toolCalls.length,
    assistant_text: assistantText,
    assistant_text_length: assistantText.length,
    workflow,
    workflow_steps: workflowSteps,
    tokens_input: tokensInput,
    tokens_output: tokensOutput,
    tokens_cache_read: tokensCacheRead,
    tokens_cache_write: tokensCacheWrite,
    cost_usd: costUsd,
    ui_error: params.uiError,
  }
}

function defaultOutputPath(args: Args, startedAt: Date): string {
  const ts = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const modelShort = args.model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
  return resolve(__dirname, `../results/${ts}_${args.probeId}_${modelShort}.json`)
}

main().catch((err) => {
  console.error('[probe] failed:')
  console.error(err)
  process.exit(1)
})
