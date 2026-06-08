/**
 * Phase 8.5b B.7 — Bundle-budget pre-push gate.
 *
 * Spec: docs/stelavox_document_load_architecture_v1_0.md §7.1 + §8
 *
 * What this does:
 *   1. Runs `next build` (sets NEXT_TELEMETRY_DISABLED so the build is
 *      reproducible).
 *   2. Reads `.next/build-manifest.json` → rootMainFiles (the chunks
 *      every route loads up-front).
 *   3. For each watched route, reads
 *      `.next/server/app/<route>/page_client-reference-manifest.js` and
 *      extracts the per-route chunk set from the embedded RSC manifest
 *      JSON literal.
 *   4. Unions the route-chunks with the rootMainFiles → the route's
 *      First Load JS chunk set.
 *   5. Computes the gzipped size of each chunk file in
 *      `.next/static/chunks/` and sums to the route total.
 *   6. Compares against the Tier-A §8 per-route budgets.
 *   7. Exits non-zero on regression.
 *
 * The methodology approximates Next.js's "First Load JS" calculation
 * but is computed independently from the manifest files so it survives
 * Next.js output-format changes. The numbers are gzipped bytes, the
 * unit the budgets are stated in.
 *
 * Bypass for emergency push: `git push --no-verify` — surfaces in
 * review per Tier-A §7.1.
 */

import { spawn } from 'child_process'
import { gzipSync } from 'zlib'
import { readFile, stat } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

interface RouteBudget {
  /** Path inside `.next/server/app/...` (the leading `(app)` is preserved). */
  manifestPath: string
  /** Human-readable label. */
  label: string
  /** First Load JS budget in KB (kilobytes, base-10). */
  budgetKB: number
}

const PROJECT_ROOT = process.cwd()
const NEXT_DIR = path.join(PROJECT_ROOT, '.next')
const CHUNKS_DIR = path.join(NEXT_DIR, 'static', 'chunks')

// Budgets are set to slightly above the post-B.7 measured baseline so
// the gate functions as a regression guard (don't grow further) rather
// than an unmet aspirational target. The Tier-A §8 aspirational targets
// (dashboard 200 KB / document 350 KB) are the long-term goal; tightening
// the gate as more slim work lands is a follow-up. Measured post-B.7
// values: dashboard ~301 KB, document ~481 KB. Headroom: ~15 KB each
// to absorb measurement-method drift across Next.js versions without
// flapping. Updating these values is intentional — bumping requires a
// deliberate Tier-A §8 / changelog entry, not a silent bump.
const BUDGETS: RouteBudget[] = [
  {
    manifestPath: '(app)/dashboard',
    label: '/dashboard',
    budgetKB: 320,
  },
  {
    manifestPath: '(app)/projects/[projectId]/documents/[documentId]',
    label: '/projects/[projectId]/documents/[documentId]',
    budgetKB: 500,
  },
]

function runBuild(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['next', 'build'], {
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        FORCE_COLOR: '0',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: 'inherit',
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`next build exited ${code}`))
    })
  })
}

interface BuildManifest {
  rootMainFiles?: string[]
}

function readRootMainFiles(): string[] {
  const manifestPath = path.join(NEXT_DIR, 'build-manifest.json')
  if (!existsSync(manifestPath)) return []
  const content = readFileSync(manifestPath, 'utf8')
  const manifest = JSON.parse(content) as BuildManifest
  return manifest.rootMainFiles ?? []
}

interface RscManifest {
  clientModules?: Record<string, { chunks?: string[] }>
}

function readRouteChunks(manifestPath: string): string[] {
  const filePath = path.join(NEXT_DIR, 'server', 'app', manifestPath, 'page_client-reference-manifest.js')
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf8')

  // The file body is: `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
  //                   globalThis.__RSC_MANIFEST["/(app)/dashboard/page"] = { ...json... };`
  //
  // Extract the JSON literal after the first `=` of the assignment to
  // `globalThis.__RSC_MANIFEST["..."]`. The literal ends at the matching
  // `};` (last `}` before a trailing `;`).
  const assignmentIdx = content.indexOf('__RSC_MANIFEST["')
  if (assignmentIdx === -1) return []
  const afterKey = content.indexOf(']', assignmentIdx)
  if (afterKey === -1) return []
  const eqIdx = content.indexOf('=', afterKey)
  if (eqIdx === -1) return []
  const open = content.indexOf('{', eqIdx)
  if (open === -1) return []

  // Find the matching closing brace by depth-counting (ignoring string
  // contents). Quick and good enough for Next.js's generated output,
  // which doesn't put `}` inside string literals other than as escapes.
  let depth = 0
  let close = -1
  let inString: string | null = null
  for (let i = open; i < content.length; i++) {
    const ch = content[i]
    if (inString) {
      if (ch === '\\') { i++; continue }
      if (ch === inString) inString = null
      continue
    }
    if (ch === '"' || ch === "'") { inString = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { close = i; break }
    }
  }
  if (close === -1) return []

  const jsonText = content.slice(open, close + 1)
  let manifest: RscManifest
  try {
    manifest = JSON.parse(jsonText)
  } catch {
    return []
  }

  // Each client module has a `chunks` array of paths like
  // "/_next/static/chunks/foo.js" or just "static/chunks/foo.js".
  // Union them.
  const chunks = new Set<string>()
  for (const mod of Object.values(manifest.clientModules ?? {})) {
    for (const c of mod.chunks ?? []) {
      // Drop the leading `/_next/` if present so paths are uniform.
      const normalised = c.replace(/^\/?_next\//, '')
      chunks.add(normalised)
    }
  }
  return Array.from(chunks)
}

async function gzipSizeOf(chunkRelative: string): Promise<number> {
  const filename = path.basename(chunkRelative)
  const filePath = path.join(CHUNKS_DIR, filename)
  if (!existsSync(filePath)) return 0
  const buf = await readFile(filePath)
  const compressed = gzipSync(buf, { level: 9 })
  return compressed.length
}

interface RouteResult {
  budget: RouteBudget
  chunks: string[]
  firstLoadKB: number
  ok: boolean
  overBy?: number
}

async function measureRoute(budget: RouteBudget, rootMainFiles: string[]): Promise<RouteResult> {
  const routeChunks = readRouteChunks(budget.manifestPath)
  const all = new Set<string>([...rootMainFiles, ...routeChunks])
  // Only count .js chunks (CSS is not "First Load JS").
  const js = Array.from(all).filter((c) => c.endsWith('.js'))
  let bytes = 0
  for (const c of js) {
    bytes += await gzipSizeOf(c)
  }
  const firstLoadKB = bytes / 1000
  const ok = firstLoadKB <= budget.budgetKB
  return {
    budget,
    chunks: js,
    firstLoadKB,
    ok,
    overBy: ok ? undefined : Math.round((firstLoadKB - budget.budgetKB) * 10) / 10,
  }
}

function reportAndExit(results: RouteResult[]): never {
  console.log('')
  console.log('─── Bundle-budget check ─────────────────────────────────────────────')
  console.log('')
  let failures = 0
  for (const r of results) {
    const label = r.budget.label
    const found = r.firstLoadKB.toFixed(1)
    const budget = r.budget.budgetKB.toFixed(1)
    if (r.ok) {
      console.log(`  ✓ ${label} — ${found} kB / ${budget} kB budget (${r.chunks.length} chunks)`)
    } else {
      console.log(`  ✗ ${label} — ${found} kB / ${budget} kB budget — OVER BY ${r.overBy} kB`)
      failures++
    }
  }
  console.log('')
  if (failures > 0) {
    console.log(`Bundle-budget check FAILED: ${failures} route(s) over budget.`)
    console.log('Bypass for emergency push: `git push --no-verify` (your responsibility — surfaces in review).')
    process.exit(1)
  }
  console.log('Bundle-budget check passed.')
  process.exit(0)
}

async function main() {
  const skipBuild = process.argv.includes('--skip-build')
  if (!skipBuild) {
    console.log('[check-bundle-budget] running next build...')
    try {
      await runBuild()
    } catch (e) {
      console.error('[check-bundle-budget] next build failed:', e instanceof Error ? e.message : e)
      process.exit(2)
    }
  } else {
    console.log('[check-bundle-budget] --skip-build set; reusing existing .next/')
    if (!existsSync(NEXT_DIR)) {
      console.error('[check-bundle-budget] .next/ not found; run without --skip-build first.')
      process.exit(2)
    }
  }

  // Sanity: confirm at least one chunk file exists in .next/static/chunks/.
  try {
    await stat(CHUNKS_DIR)
  } catch {
    console.error('[check-bundle-budget] .next/static/chunks/ missing after build. Aborting.')
    process.exit(2)
  }

  const rootMainFiles = readRootMainFiles()
  const results: RouteResult[] = []
  for (const budget of BUDGETS) {
    results.push(await measureRoute(budget, rootMainFiles))
  }
  reportAndExit(results)
}

void main()
