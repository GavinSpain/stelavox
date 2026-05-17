/**
 * Director cross-model comparison runner.
 *
 * Runs the same probe against multiple models in sequence, with a fresh
 * fixture re-seed before each run, and emits a side-by-side comparison
 * markdown that can be scored against issues.md.
 *
 * Usage:
 *   npx tsx scripts/run-director-comparison.ts \
 *     --scenario j5-novel \
 *     --probe-id P-J5 \
 *     --models claude-haiku-4-5-20251001,claude-sonnet-4-6,claude-opus-4-7 \
 *     [--output-dir results]
 *
 * Output:
 *   - One <ts>_<probe>_<modelShort>.json per model.
 *   - One <ts>_<probe>_comparison.md with a comparison table.
 *
 * Spec authority: docs/stelavox_director_eval_methodology_v1_0.md §6
 * (model-upgrade evaluation runs the corpus across candidate models).
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { execSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

import { getProbe } from '../fixtures/director-corpus/j5-novel/probes'
import type { ProbeResult } from './run-director-probe'

interface Args {
  scenario: string
  probeId: string
  models: string[]
  outputDir: string
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  let scenario = ''
  let probeId = ''
  let models: string[] = []
  let outputDir = resolve(__dirname, '../results')

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--scenario') scenario = args[++i]
    else if (a === '--probe-id') probeId = args[++i]
    else if (a === '--models') models = args[++i].split(',').map((m) => m.trim()).filter(Boolean)
    else if (a === '--output-dir') outputDir = args[++i]
    else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/run-director-comparison.ts --scenario <slug> --probe-id <id> --models a,b,c [--output-dir results]')
      process.exit(0)
    }
  }

  if (!scenario) fail('--scenario is required')
  if (!probeId) fail('--probe-id is required')
  if (models.length === 0) fail('--models <comma-separated list> is required')

  return { scenario, probeId, models, outputDir }
}

function fail(msg: string): never {
  console.error(`error: ${msg}`)
  process.exit(1)
}

function modelShort(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

function shortish(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n - 1) + '…'
}

function buildComparisonMarkdown(probeId: string, probeText: string, results: ProbeResult[]): string {
  const ts = results[0]?.started_at ?? new Date().toISOString()
  const lines: string[] = []
  lines.push(`# Director cross-model comparison`)
  lines.push('')
  lines.push(`- **Probe:** \`${probeId}\``)
  lines.push(`- **Probe text:** ${probeText}`)
  lines.push(`- **Run started:** ${ts}`)
  lines.push(`- **Models compared:** ${results.map((r) => modelShort(r.model_id)).join(', ')}`)
  lines.push('')

  // ── Headline metrics table ──
  lines.push('## Headline metrics')
  lines.push('')
  lines.push('| Metric | ' + results.map((r) => modelShort(r.model_id)).join(' | ') + ' |')
  lines.push('|---|' + results.map(() => '---').join('|') + '|')
  lines.push('| Tool calls | ' + results.map((r) => String(r.tool_call_count)).join(' | ') + ' |')
  lines.push('| Assistant text length | ' + results.map((r) => String(r.assistant_text_length)).join(' | ') + ' |')
  lines.push('| Workflow proposed | ' + results.map((r) => r.workflow ? `✓ (${r.workflow_steps.length} steps)` : '✗ none').join(' | ') + ' |')
  lines.push('| Tokens (in/out) | ' + results.map((r) => `${r.tokens_input ?? '?'} / ${r.tokens_output ?? '?'}`).join(' | ') + ' |')
  lines.push('| Cost (USD) | ' + results.map((r) => `$${(r.cost_usd ?? 0).toFixed(4)}`).join(' | ') + ' |')
  lines.push('| Duration | ' + results.map((r) => `${(r.duration_ms / 1000).toFixed(1)}s`).join(' | ') + ' |')
  lines.push('| UI error | ' + results.map((r) => r.ui_error ? `⚠ ${shortish(r.ui_error, 40)}` : '—').join(' | ') + ' |')
  lines.push('')

  // ── Tool-call breakdown ──
  lines.push('## Tool-call sequences')
  lines.push('')
  for (const r of results) {
    lines.push(`### ${modelShort(r.model_id)}`)
    lines.push('')
    if (r.tool_calls.length === 0) {
      lines.push('_No tool calls._')
    } else {
      const counts: Record<string, number> = {}
      for (const tc of r.tool_calls) counts[tc.name] = (counts[tc.name] ?? 0) + 1
      lines.push('Total: ' + r.tool_call_count + ' calls. By tool: ' + Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', '))
      lines.push('')
      lines.push('Sequence:')
      lines.push('')
      r.tool_calls.forEach((tc, i) => {
        lines.push(`${i + 1}. \`${tc.name}\` → ${tc.validation_result}`)
      })
    }
    lines.push('')
  }

  // ── Workflow proposals ──
  lines.push('## Workflow proposals')
  lines.push('')
  for (const r of results) {
    lines.push(`### ${modelShort(r.model_id)}`)
    lines.push('')
    if (!r.workflow) {
      lines.push('_No workflow proposal emitted._')
    } else {
      lines.push(`**Title:** ${r.workflow.title}`)
      lines.push('')
      if (r.workflow.description) lines.push(`**Description:** ${r.workflow.description}`)
      if (r.workflow.impact_summary) lines.push(`**Impact:** ${r.workflow.impact_summary}`)
      lines.push('')
      lines.push('**Steps:**')
      lines.push('')
      r.workflow_steps.forEach((s) => {
        lines.push(`${s.order}. **${s.operation_type}** → \`${s.target_node_id.slice(0, 8)}…\` — ${s.description ?? '(no description)'}`)
      })
    }
    lines.push('')
  }

  // ── Assistant text (full) ──
  lines.push('## Assistant text (full)')
  lines.push('')
  for (const r of results) {
    lines.push(`### ${modelShort(r.model_id)}`)
    lines.push('')
    lines.push('```')
    lines.push(r.assistant_text || '(empty)')
    lines.push('```')
    lines.push('')
  }

  // ── Scoring template ──
  lines.push('## Scoring template (hand-fill against issues.md)')
  lines.push('')
  lines.push('| Issue | ' + results.map((r) => modelShort(r.model_id)).join(' | ') + ' | Notes |')
  lines.push('|---|' + results.map(() => '---').join('|') + '|---|')
  const issueIds = [
    'L1-PACING-01', 'L1-ORDER-01', 'L1-REPETITION-01', 'L1-CHARACTER-01',
    'L2-POV-01', 'L2-PACING-02', 'L2-VOICE-01', 'L2-FORESHADOW-01',
    'L3-ANTAGONIST-01', 'L3-THEME-01', 'L3-MOTIF-01', 'L3-CHARACTER-02',
    'L4-WANT-NEED-01', 'L4-IMPLICIT-CHAR-01', 'L4-TONAL-01',
  ]
  for (const id of issueIds) {
    lines.push(`| ${id} | ` + results.map(() => '?').join(' | ') + ' | |')
  }
  lines.push('')
  lines.push('Score legend: ✓ Found · ◐ Partial · ✗ Missed · — N/A')
  lines.push('')

  return lines.join('\n')
}

async function main() {
  const args = parseArgs()
  const probe = getProbe(args.probeId)
  const startedAt = new Date()
  const ts = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19)

  console.log(`[compare] scenario=${args.scenario} probe=${args.probeId} models=${args.models.join(', ')}`)

  mkdirSync(args.outputDir, { recursive: true })

  const results: ProbeResult[] = []
  for (const model of args.models) {
    const outPath = resolve(args.outputDir, `${ts}_${args.probeId}_${modelShort(model)}.json`)
    console.log(`\n[compare] === running on ${model} ===`)
    try {
      execSync(
        `npx tsx scripts/run-director-probe.ts --scenario ${args.scenario} --probe-id ${args.probeId} --model ${model} --reset --output ${outPath}`,
        {
          cwd: resolve(__dirname, '..'),
          stdio: 'inherit',
          encoding: 'utf8',
        },
      )
    } catch {
      console.warn(`[compare] run on ${model} exited non-zero — capturing whatever was written.`)
    }
    try {
      const r = JSON.parse(readFileSync(outPath, 'utf8')) as ProbeResult
      results.push(r)
    } catch (err) {
      console.error(`[compare] failed to read result for ${model}: ${(err as Error).message}`)
    }
  }

  if (results.length === 0) fail('no results captured')

  const comparison = buildComparisonMarkdown(args.probeId, probe.text, results)
  const compPath = resolve(args.outputDir, `${ts}_${args.probeId}_comparison.md`)
  writeFileSync(compPath, comparison, 'utf8')
  console.log(`\n[compare] comparison → ${compPath}`)
  console.log(`[compare] ${results.length} models compared. Total cost: $${results.reduce((s, r) => s + (r.cost_usd ?? 0), 0).toFixed(4)}`)
}

main().catch((err) => {
  console.error('[compare] failed:')
  console.error(err)
  process.exit(1)
})
