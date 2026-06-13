/**
 * Phase 9.E (DR-050) — injection security-warning wiring.
 *
 * Pins: (a) isInjectionBlockedError recognises the runner's persisted
 * error_message shape; (b) the failure-message bundle carries the
 * admin-tunable injection copy (M-224).
 */

import { describe, expect, it } from 'vitest'

import { isInjectionBlockedError } from '@/components/feedback/SecurityWarningBanner'
import { getFailureMessageBundle } from '@/lib/ui/failureMessages'

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const hasServiceKey = SERVICE_KEY !== ''

describe('isInjectionBlockedError', () => {
  it('matches the runner-persisted shape injection_blocked:<field>', () => {
    expect(isInjectionBlockedError('injection_blocked:refinement_instruction')).toBe(true)
    expect(isInjectionBlockedError('injection_blocked:current_node.prose')).toBe(true)
    expect(isInjectionBlockedError('injection_blocked')).toBe(true)
  })

  it('does not match other error messages', () => {
    expect(isInjectionBlockedError('target_version_mismatch:3:4')).toBe(false)
    expect(isInjectionBlockedError('model_output_truncated')).toBe(false)
    expect(isInjectionBlockedError(null)).toBe(false)
    expect(isInjectionBlockedError(undefined)).toBe(false)
    expect(isInjectionBlockedError('')).toBe(false)
  })
})

describe.skipIf(!hasServiceKey)('failure-message bundle (M-224)', () => {
  it('carries the injection_blocked_message from platform_config', async () => {
    const bundle = await getFailureMessageBundle()
    expect(typeof bundle.injection_blocked_message).toBe('string')
    expect(bundle.injection_blocked_message.length).toBeGreaterThan(0)
    // Per the author lock — the copy must communicate there is no override.
    expect(bundle.injection_blocked_message.toLowerCase()).toMatch(/cannot be overridden|no.*override|manually/)
  })
})
