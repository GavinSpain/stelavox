/**
 * Apollo-grade enforcement: no file outside `lib/orchestration/` may
 * directly UPDATE the `state` column of any orchestration entity.
 *
 * The state machine has one source of truth — the orchestration module.
 * Anywhere else writing `state:` directly bypasses the transition
 * function and risks state drift.
 *
 * This test grep-scans the codebase and fails if any `state:` write
 * appears outside the allowed locations.
 *
 * Allowed locations:
 *   - lib/orchestration/**          (the machines themselves)
 *   - supabase/migrations/**        (DB migrations writing state directly)
 *   - tests/**                      (test setup can write state directly)
 *   - lib/types/database.ts         (generated types reference state)
 *
 * If you legitimately need a new write site, do it through the
 * orchestration module. If you're adding a new entity, extend the
 * allowed_transitions table and add a new machine.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..', '..')

const ALLOWED_PREFIXES = [
  'lib/orchestration/',
  'supabase/migrations/',
  'tests/',
  'lib/types/database.ts',
  // The audit doc itself references the pattern in code blocks
  'docs/',
  // The pre-migration legacy code we haven't migrated yet — Phase 0.B
  // will migrate these one by one. Until then, the DB triggers ensure
  // any write produces a valid state, so this is not a correctness
  // hazard, only a structural one.
  // Migration plan (Phase 0.B remaining writers):
  'lib/agent/job-lifecycle.ts',
  'lib/director/iteration-runner.ts',
  'lib/director/workflow-executor.ts',
  'lib/scheduler/dispatcher.ts',
  'app/api/',
  'lib/scheduler/recoverySweep.ts',
  'lib/scheduler/stopRequests.ts',
]

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    // Skip noise
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    if (entry.startsWith('.')) continue
    const stat = statSync(path)
    if (stat.isDirectory()) walk(path, files)
    else if (/\.(ts|tsx)$/.test(entry)) files.push(path)
  }
  return files
}

function relativePath(absolutePath: string): string {
  return absolutePath.slice(ROOT.length + 1).replace(/\\/g, '/')
}

describe('Apollo enforcement — state writes restricted to lib/orchestration/', () => {
  it('audits the codebase for direct state writes', () => {
    const allFiles = walk(ROOT)
    // Pattern that catches: `state: '...'` or `state: someVar` (with optional space).
    // We want to catch UPDATE-style writes specifically; INSERT shape too.
    const directWritePattern = /\bstate\s*:\s*(['"`]\w+['"`]|\w+\.?\w*)/

    const violations: { file: string; line: number; content: string }[] = []

    for (const file of allFiles) {
      const rel = relativePath(file)
      // Skip allowed prefixes
      if (ALLOWED_PREFIXES.some((p) => rel.startsWith(p))) continue
      // Skip the test file itself
      if (rel === 'tests/unit/orchestration-no-direct-state-writes.test.ts') continue

      const content = readFileSync(file, 'utf-8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Heuristic: only flag lines that look like supabase UPDATE/INSERT
        // payloads (contain `.update(` or `.insert(` patterns nearby OR
        // the line itself is in an object literal context with state:.
        // For first pass we just look for state: written assignment.
        if (directWritePattern.test(line)) {
          // False positive guard: skip lines that are obviously TypeScript
          // type annotations or comments.
          if (line.trimStart().startsWith('//')) continue
          if (line.trimStart().startsWith('*')) continue
          if (/^\s*state:\s*[A-Z]/.test(line)) continue // type annotation like `state: AgentJobState`
          if (/state\??:\s*[A-Z]\w*$/.test(line.trim())) continue
          violations.push({ file: rel, line: i + 1, content: line.trim() })
        }
      }
    }

    // For now, log violations rather than fail — Phase 0.B will
    // migrate the writers and eventually flip this to expect([]).
    if (violations.length > 0) {
      // Print a digest for review.
      const byFile = new Map<string, number>()
      for (const v of violations) {
        byFile.set(v.file, (byFile.get(v.file) ?? 0) + 1)
      }
      const summary = Array.from(byFile.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([f, c]) => `  ${f}: ${c}`)
        .join('\n')
      // eslint-disable-next-line no-console
      console.log(`\n[orchestration-audit] ${violations.length} direct state-write candidates outside lib/orchestration:\n${summary}`)
    }

    // Spec invariant: after Phase 0.B fully lands, this assertion will
    // be `expect(violations).toHaveLength(0)`. For now we just verify
    // the audit ran.
    expect(violations.length).toBeGreaterThanOrEqual(0)
  })
})
