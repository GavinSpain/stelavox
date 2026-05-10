// B6.3 — round-3 audit F-19.
//
// Pre-fix `lib/llm/token-budget.ts` inspected `org.plan` strings and
// `lib/llm/factory.ts` inspected `org.byok_enabled` boolean. Two
// sources of truth for "is this org BYOK?" The new central
// `isByok(org)` helper consults BOTH and returns the most permissive
// answer.
//
// Test the helper directly. Constraint-driven: the helper is the
// canonical answer; both call sites flow through it.

import { describe, expect, it } from 'vitest'
import { isByok } from '@/lib/llm/byok'

describe('B6.3 — F-19: isByok unifies BYOK detection across the codebase', () => {
  it('returns true when byok_enabled = true (V2 column-driven path)', () => {
    expect(isByok({ byok_enabled: true })).toBe(true)
    expect(isByok({ byok_enabled: true, plan: 'writer' })).toBe(true)
  })

  it('returns true for known BYOK plan names (V1 defensive path)', () => {
    expect(isByok({ plan: 'byok_solo' })).toBe(true)
    expect(isByok({ plan: 'byok_team' })).toBe(true)
    expect(isByok({ plan: 'byok_enterprise' })).toBe(true)
  })

  it('returns false for non-BYOK plans with byok_enabled false/null/undefined', () => {
    expect(isByok({ plan: 'writer' })).toBe(false)
    expect(isByok({ plan: 'author' })).toBe(false)
    expect(isByok({ plan: 'pro', byok_enabled: false })).toBe(false)
    expect(isByok({ plan: 'trial', byok_enabled: null })).toBe(false)
  })

  it('returns false for unknown plan with no byok_enabled signal', () => {
    expect(isByok({ plan: 'mystery_tier' })).toBe(false)
    expect(isByok({})).toBe(false)
  })

  it('treats agreement and disagreement permissively', () => {
    // Both signals say BYOK → BYOK.
    expect(isByok({ plan: 'byok_solo', byok_enabled: true })).toBe(true)
    // Plan says BYOK, byok_enabled false → BYOK (most permissive).
    expect(isByok({ plan: 'byok_solo', byok_enabled: false })).toBe(true)
    // Plan says non-BYOK, byok_enabled true → BYOK.
    expect(isByok({ plan: 'writer', byok_enabled: true })).toBe(true)
  })
})
