// B1.3 — verifies the H-01 ESLint guardrail in eslint.config.mjs.
//
// Programmatically runs ESLint against two synthetic source strings:
//
//   bad:  a lib/data/-style file that ends a chain with .single()
//         without a disable directive — the rule must fire.
//
//   good: the same chain with a // eslint-disable-next-line directive
//         on the line above the chain start — the rule must NOT fire.
//
// Constraint-driven test feasibility: the rule itself is the test
// surface. Failing-test-first proof: this test file fails when the
// rule is removed from eslint.config.mjs (no error reported on the
// bad fixture); passes when the rule is in place.

import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

async function lintLibDataFixture(source: string): Promise<ESLint.LintResult[]> {
  // Run ESLint as if the file lived at lib/data/probe.ts so the
  // file-scoped `files: ["lib/data/**/*.ts"]` config block applies.
  const eslint = new ESLint({ cwd: process.cwd() })
  return eslint.lintText(source, { filePath: 'lib/data/probe.ts' })
}

describe('B1.3 — H-01 ESLint guardrail (no-restricted-syntax in lib/data/)', () => {
  it('fires on a bare .single() chain inside lib/data/', async () => {
    const bad = `
import type { SupabaseClient } from '@supabase/supabase-js'

export async function probe(supabase: SupabaseClient) {
  return supabase
    .from('projects')
    .update({ name: 'x' })
    .eq('id', 'fake')
    .select('id')
    .single()
}
`
    const [result] = await lintLibDataFixture(bad)
    const h01Messages = result.messages.filter(m => m.ruleId === 'no-restricted-syntax')
    expect(h01Messages.length).toBeGreaterThanOrEqual(1)
    expect(h01Messages[0]!.severity).toBe(2) // error
    expect(h01Messages[0]!.message).toMatch(/H-01/)
  })

  it('does not fire when the chain has a disable directive (legitimate INSERT)', async () => {
    const good = `
import type { SupabaseClient } from '@supabase/supabase-js'

export async function probe(supabase: SupabaseClient) {
  // eslint-disable-next-line no-restricted-syntax -- INSERT validation: zero rows is an error here.
  return supabase
    .from('projects')
    .insert({ name: 'x' })
    .select('id')
    .single()
}
`
    const [result] = await lintLibDataFixture(good)
    const h01Messages = result.messages.filter(m => m.ruleId === 'no-restricted-syntax')
    expect(h01Messages.length).toBe(0)
  })
})
