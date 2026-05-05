#!/usr/bin/env node
/**
 * Phase 5 cost-report CLI.
 *
 * Source: stelavox_phase5_test_plan_v1_0.md v1.1 §1.4, §10.4
 *         Build Checklist T-16.1.5 / T-16.2.5 / T-16.6
 *
 * Reads agent_jobs from a date range and writes a markdown summary
 * grouped by operation_type and model. Used at chunk boundaries
 * during T-16.1, after cloud smoke, and as input to Test Report §10.
 *
 * Usage:
 *   npx tsx scripts/cost-report.ts --since="2026-05-05T00:00:00Z" --until=now
 *   npx tsx scripts/cost-report.ts --since=1h --label=t16-chunk1
 *
 * --since: ISO timestamp or relative ('1h', '24h', '7d')
 * --until: ISO timestamp or 'now' (default)
 * --label: filename suffix for test-reports/cost/<label>-<ts>.md
 * --env:   'local' (default) or 'cloud' — picks which Supabase URL to use
 */

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { loadEnv } from '../tests/helpers/env'

loadEnv()

interface Args {
  since: string
  until: string
  label: string
  env: 'local' | 'cloud'
}

function parseArgs(): Args {
  const out: Args = { since: '24h', until: 'now', label: 'cost', env: 'local' }
  for (const arg of process.argv.slice(2)) {
    const [key, val] = arg.replace(/^--/, '').split('=')
    if (key === 'since') out.since = val ?? '24h'
    else if (key === 'until') out.until = val ?? 'now'
    else if (key === 'label') out.label = val ?? 'cost'
    else if (key === 'env') out.env = (val === 'cloud' ? 'cloud' : 'local')
  }
  return out
}

function resolveTimestamp(spec: string): Date {
  if (spec === 'now') return new Date()
  if (/^\d+[hdm]$/.test(spec)) {
    const n = parseInt(spec, 10)
    const unit = spec.slice(-1)
    const ms = unit === 'h' ? n * 3600_000 : unit === 'd' ? n * 86_400_000 : n * 60_000
    return new Date(Date.now() - ms)
  }
  return new Date(spec)
}

interface JobRow {
  id: string
  operation_type: string
  status: string
  model_id: string | null
  cost_usd: number | null
  tokens_input: number | null
  tokens_output: number | null
  tokens_cache_read: number | null
  tokens_cache_write: number | null
  started_at: string | null
  completed_at: string | null
}

async function main() {
  const args = parseArgs()
  const since = resolveTimestamp(args.since)
  const until = resolveTimestamp(args.until)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  const { data, error } = await sb.from('agent_jobs')
    .select('id, operation_type, status, model_id, cost_usd, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, started_at, completed_at')
    .gte('created_at', since.toISOString())
    .lte('created_at', until.toISOString())
    .order('created_at', { ascending: true })
  if (error) throw new Error(`query failed: ${error.message}`)
  const rows = (data ?? []) as JobRow[]

  const groups = new Map<string, { count: number; cost: number; ti: number; to: number; tcr: number; tcw: number }>()
  let totalCost = 0
  let totalTokensIn = 0
  let totalTokensOut = 0

  for (const r of rows) {
    const k = r.operation_type + '|' + (r.model_id ?? 'null')
    const g = groups.get(k) ?? { count: 0, cost: 0, ti: 0, to: 0, tcr: 0, tcw: 0 }
    g.count += 1
    g.cost += r.cost_usd ?? 0
    g.ti += r.tokens_input ?? 0
    g.to += r.tokens_output ?? 0
    g.tcr += r.tokens_cache_read ?? 0
    g.tcw += r.tokens_cache_write ?? 0
    groups.set(k, g)
    totalCost += r.cost_usd ?? 0
    totalTokensIn += r.tokens_input ?? 0
    totalTokensOut += r.tokens_output ?? 0
  }

  const statusCounts = new Map<string, number>()
  for (const r of rows) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1)

  const lines: string[] = []
  lines.push('# Phase 5 cost report --- ' + args.label)
  lines.push('')
  lines.push('**Window:** ' + since.toISOString() + ' to ' + until.toISOString())
  lines.push('**Env:** ' + args.env)
  lines.push('**Total jobs:** ' + rows.length)
  lines.push('**Total cost:** $' + totalCost.toFixed(6))
  lines.push('**Total tokens:** ' + totalTokensIn.toLocaleString() + ' in / ' + totalTokensOut.toLocaleString() + ' out')
  lines.push('')

  lines.push('## Status breakdown')
  lines.push('')
  lines.push('| Status | Count |')
  lines.push('|---|---|')
  for (const [s, c] of [...statusCounts.entries()].sort()) lines.push('| ' + s + ' | ' + c + ' |')
  lines.push('')

  lines.push('## Per-operation x model')
  lines.push('')
  lines.push('| Operation | Model | Count | Total $ | Avg $ | Avg in | Avg out |')
  lines.push('|---|---|---|---|---|---|---|')
  for (const [k, g] of [...groups.entries()].sort()) {
    const [op, model] = k.split('|')
    lines.push('| ' + op + ' | ' + model + ' | ' + g.count + ' | $' + g.cost.toFixed(6) + ' | $' + (g.cost / g.count).toFixed(6) + ' | ' + Math.round(g.ti / g.count) + ' | ' + Math.round(g.to / g.count) + ' |')
  }
  lines.push('')

  lines.push('## Recent jobs (last 20)')
  lines.push('')
  lines.push('| op | status | model | $ | tokens (in/out) |')
  lines.push('|---|---|---|---|---|')
  for (const r of rows.slice(-20)) {
    lines.push('| ' + r.operation_type + ' | ' + r.status + ' | ' + (r.model_id ?? '-') + ' | ' + (r.cost_usd != null ? '$' + r.cost_usd.toFixed(6) : '-') + ' | ' + (r.tokens_input ?? '-') + '/' + (r.tokens_output ?? '-') + ' |')
  }

  const dir = resolve(process.cwd(), 'test-reports', 'cost')
  mkdirSync(dir, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const path = resolve(dir, args.label + '-' + ts + '.md')
  writeFileSync(path, lines.join('\n'))
  console.log('wrote ' + path)
  console.log('total cost: $' + totalCost.toFixed(6) + ' across ' + rows.length + ' jobs')
}

main().catch(e => { console.error(e); process.exit(1) })
