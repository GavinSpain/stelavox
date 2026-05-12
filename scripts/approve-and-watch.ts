/**
 * Approve a draft workflow and watch agent_jobs run, then dump telemetry.
 *
 * Used to verify Migration 053's preceding-sibling context plumbing:
 *   $ APP_URL=http://localhost:3000 npx tsx scripts/approve-and-watch.ts <workflow_id>
 *
 * Approves via the same /api/director/workflows/[id]/approve API the UI
 * uses (Playwright session for auth), then polls until every step is
 * complete (or 5-minute timeout). After completion, prints for each
 * agent_job:
 *   - whether context_snapshot.dynamic.precedingSiblings is populated
 *   - the names of the preceding siblings it contains
 *   - input / cache / output token counts
 *
 * One-off — delete after preceding-sibling validation is settled.
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000'
const AUTHOR_EMAIL = 'author@stelavox.local'
const AUTHOR_PASSWORD = 'Test1234!Test1234!'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

async function main() {
  const workflowId = process.argv[2]
  if (!workflowId) {
    console.error('usage: tsx scripts/approve-and-watch.ts <workflow_id>')
    process.exit(1)
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
    console.log(`[watch] logged in as ${AUTHOR_EMAIL}`)

    const approveRes = await page.request.post(
      `${APP_URL}/api/director/workflows/${workflowId}/approve`,
      { data: {} },
    )
    if (!approveRes.ok()) {
      console.error(`[watch] approve failed: ${approveRes.status()} ${await approveRes.text()}`)
      process.exit(1)
    }
    console.log(`[watch] approved workflow ${workflowId}`)

    // Poll until all steps reach a terminal status.
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
      const total = steps?.length ?? 0
      console.log(`[watch] ${total - pending}/${total} done ${JSON.stringify(counts)}`)
      if (pending === 0 && total > 0) break
      await new Promise((r) => setTimeout(r, 3000))
    }

    // Dump per-job telemetry.
    const { data: jobs } = await db
      .from('agent_jobs')
      .select('id, started_at, completed_at, status, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_usd, context_snapshot, node_id')
      .in(
        'id',
        ((
          await db.from('workflow_steps').select('agent_job_id').eq('workflow_id', workflowId)
        ).data ?? [])
          .map((r) => r.agent_job_id)
          .filter(Boolean) as string[],
      )
      .order('started_at')

    console.log('\n══════════════════════════════════════════════════════════')
    console.log('AGENT-JOB TELEMETRY (preceding-siblings probe)')
    console.log('══════════════════════════════════════════════════════════')
    let stepIdx = 0
    for (const job of jobs ?? []) {
      stepIdx++
      const cs = job.context_snapshot as Record<string, unknown> | null
      const dyn = (cs?.['dynamic'] ?? {}) as Record<string, unknown>
      const ps = (dyn['precedingSiblings'] as string) ?? ''
      const psNames = Array.from(ps.matchAll(/<name>([^<]+)<\/name>/g)).map((m) => m[1])
      const psHasProse = /<prose>/.test(ps)
      const psHasSummary = /<summary>/.test(ps)
      const { data: target } = await db
        .from('nodes')
        .select('name')
        .eq('id', job.node_id as string)
        .maybeSingle()
      console.log(
        `\nstep ${stepIdx}: ${target?.name ?? '?'} (${job.status})` +
          `\n  tokens: ${job.tokens_input} in / ${job.tokens_output} out` +
          ` / ${job.tokens_cache_read} cache_read / ${job.tokens_cache_write} cache_write` +
          `  $${(job.cost_usd as number)?.toFixed(4)}` +
          `\n  precedingSiblings: ${ps.length === 0 ? '(empty)' : `${psNames.length} sibling(s)`}`,
      )
      if (psNames.length > 0) {
        console.log(`    names: ${psNames.join(', ')}`)
        console.log(`    contains <prose>=${psHasProse}, <summary>=${psHasSummary}`)
        console.log(`    block length: ${ps.length}ch`)
      }
    }
    console.log('\n══════════════════════════════════════════════════════════')
  } finally {
    await browser.close()
  }
}

main().catch((e) => {
  console.error('[watch] fatal:', e)
  process.exit(1)
})
