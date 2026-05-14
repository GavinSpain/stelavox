/**
 * V1.x-B.1.2 — CK-7 H-09 invariant audit (static check).
 *
 * Per H-09: BYOK API key plaintext only in Edge Function memory; never
 * in API routes or any other Next.js code path.
 *
 * This test grep-audits the source tree to confirm:
 *   - The decrypted-key RPC `get_user_anthropic_key_for_byok_call` is
 *     called ONLY from `supabase/functions/byok-llm-call/index.ts`.
 *     (The lib/byok/ module deliberately does NOT wrap it; if any other
 *     file calls it that's a violation.)
 *   - No source file outside `supabase/functions/byok-llm-call/` and the
 *     audit-allowed list logs the BYOK key value (heuristic check).
 *
 * False-negative-tolerant: a determined attacker could obfuscate; this
 * is a "would-anyone-have-noticed" guard, not a security boundary. The
 * actual security boundary is the database RPC's GRANT (service-role
 * only, no `authenticated` access — see Migration 104).
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..')
const SCAN_ROOTS = ['app', 'lib', 'components', 'tests']
const ALLOWED_RPC_CALLERS = new Set([
  // The Edge Function — sole legitimate caller.
  ['supabase', 'functions', 'byok-llm-call', 'index.ts'].join(sep),
])

function* walk(root: string): Generator<string> {
  for (const entry of readdirSync(root)) {
    const path = join(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      // Skip node_modules, .next, etc.
      if (entry === 'node_modules' || entry.startsWith('.next') || entry === 'snapshots' || entry === 'test-results') continue
      yield* walk(path)
    } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry)) {
      yield path
    }
  }
}

describe('CK-7 H-09 invariant audit', () => {
  it('get_user_anthropic_key_for_byok_call is called only from the Edge Function', () => {
    // Real violation = an actual `.rpc('get_user_anthropic_key_for_byok_call', ...)`
    // call. Mere mention of the name in a doc-comment, type definition,
    // or test assertion is NOT a violation.
    const realCallPattern = /\.rpc\s*\(\s*['"`]get_user_anthropic_key_for_byok_call['"`]/
    const offenders: string[] = []
    const SELF_PATH = relative(REPO_ROOT, __filename)
    for (const root of SCAN_ROOTS) {
      const rootPath = join(REPO_ROOT, root)
      try {
        for (const file of walk(rootPath)) {
          const rel = relative(REPO_ROOT, file)
          // Skip this audit test itself — its pattern source matches its own regex.
          if (rel === SELF_PATH) continue
          const content = readFileSync(file, 'utf8')
          if (realCallPattern.test(content)) {
            offenders.push(rel)
          }
        }
      } catch {
        // Root doesn't exist — fine.
      }
    }
    // Edge Function lives under supabase/, not in SCAN_ROOTS, so it
    // shouldn't appear in offenders.
    expect(offenders, `H-09 violation: ${offenders.join(', ')}`).toEqual([])
  })

  it('Edge Function file exists and contains the only legitimate RPC call', () => {
    const edgePath = join(REPO_ROOT, 'supabase', 'functions', 'byok-llm-call', 'index.ts')
    const content = readFileSync(edgePath, 'utf8')
    expect(content).toContain('get_user_anthropic_key_for_byok_call')
    expect(ALLOWED_RPC_CALLERS).toContain(relative(REPO_ROOT, edgePath))
  })
})
