/**
 * Phase 9.B admin payments — drift guard.
 *
 * The Stripe SDK's apiVersion is read from `stripe.api_version`
 * platform_config (M-223). Re-introducing a hardcoded `apiVersion: '...'`
 * literal in `lib/stripe/` would silently override the config and defeat
 * the admin-roll-forward workflow.
 *
 * This test grep-scans `lib/stripe/*.ts` for `apiVersion:` followed by
 * a string literal. The only legitimate occurrence is the `as never`
 * cast site in `lib/stripe/client.ts`, which reads the version from
 * config first — that line passes the string variable, not a literal.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const STRIPE_LIB = join(__dirname, '..', '..', 'lib', 'stripe')

function tsFilesIn(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...tsFilesIn(full))
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full)
  }
  return out
}

describe('Stripe API version is not hardcoded (M-223 drift guard)', () => {
  it('no `apiVersion: "..."` string literal in lib/stripe/*.ts', () => {
    const files = tsFilesIn(STRIPE_LIB)
    // Pattern: `apiVersion` + optional whitespace + `:` + optional whitespace
    // + a single-quoted or double-quoted string literal that contains a digit
    // (matching Stripe API version dates like '2026-05-27.dahlia').
    const literalRegex = /apiVersion\s*:\s*['"][^'"]*\d[^'"]*['"]/

    const offenders: Array<{ file: string; line: number; text: string }> = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      const lines = content.split(/\r?\n/)
      lines.forEach((text, idx) => {
        if (literalRegex.test(text)) {
          offenders.push({
            file: file.replace(/\\/g, '/').split('/lib/stripe/').pop() ?? file,
            line: idx + 1,
            text: text.trim(),
          })
        }
      })
    }

    expect(
      offenders,
      `Stripe API version must be read from platform_config (M-223). Found apiVersion: "..." literal(s):\n${offenders
        .map((o) => `  lib/stripe/${o.file}:${o.line}: ${o.text}`)
        .join('\n')}`,
    ).toEqual([])
  })
})
