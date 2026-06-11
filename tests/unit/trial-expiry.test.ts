/**
 * Phase 9.B work package B — trial-expiry helpers.
 *
 * Pure-function tests for isTrialExpired() + isPathTrialExempt(). The
 * (app)/layout.tsx wires both together — the layout test is a deferred
 * Playwright case once a Stripe account exists; until then the helpers
 * carry the user-visible invariant.
 */

import { describe, expect, it } from 'vitest'

import { isPathTrialExempt, isTrialExpired } from '@/lib/billing/trialExpiry'

describe('isTrialExpired', () => {
  const NOW = new Date('2026-06-15T12:00:00Z')

  it('returns false for a non-trial plan', () => {
    expect(isTrialExpired({ plan: 'writer', trial_expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false)
    expect(isTrialExpired({ plan: 'author', trial_expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false)
    expect(isTrialExpired({ plan: 'pro', trial_expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false)
    expect(isTrialExpired({ plan: 'byok_solo', trial_expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false)
  })

  it('returns false for a trial plan whose expiry is in the future', () => {
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: '2026-07-15T12:00:00Z' }, NOW)).toBe(false)
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: '2026-06-15T12:00:01Z' }, NOW)).toBe(false)
  })

  it('returns true for a trial plan whose expiry has elapsed', () => {
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: '2026-06-15T11:59:59Z' }, NOW)).toBe(true)
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: '2026-05-15T12:00:00Z' }, NOW)).toBe(true)
  })

  it('returns true at the exact expiry instant', () => {
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: '2026-06-15T12:00:00Z' }, NOW)).toBe(true)
  })

  it('returns false when plan is null (defensive)', () => {
    expect(isTrialExpired({ plan: null, trial_expires_at: '2020-01-01T00:00:00Z' }, NOW)).toBe(false)
  })

  it('returns false when trial_expires_at is null', () => {
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: null }, NOW)).toBe(false)
  })

  it('returns false for an unparseable trial_expires_at string', () => {
    expect(isTrialExpired({ plan: 'trial', trial_expires_at: 'not a date' }, NOW)).toBe(false)
  })
})

describe('isPathTrialExempt', () => {
  it('exempts /settings/plan and child paths', () => {
    expect(isPathTrialExempt('/settings/plan')).toBe(true)
    expect(isPathTrialExempt('/settings/plan/anything')).toBe(true)
    expect(isPathTrialExempt('/settings/plan?reason=trial_expired')).toBe(true)
  })

  it('exempts /api/billing/* and /api/stripe/* paths', () => {
    expect(isPathTrialExempt('/api/billing/checkout')).toBe(true)
    expect(isPathTrialExempt('/api/billing/portal')).toBe(true)
    expect(isPathTrialExempt('/api/stripe/webhook')).toBe(true)
  })

  it('does NOT exempt /settings (other settings pages)', () => {
    expect(isPathTrialExempt('/settings')).toBe(false)
    expect(isPathTrialExempt('/settings/api-keys')).toBe(false)
    expect(isPathTrialExempt('/settings/org-api-keys')).toBe(false)
    expect(isPathTrialExempt('/settings/usage')).toBe(false)
  })

  it('does NOT exempt dashboard / projects / admin', () => {
    expect(isPathTrialExempt('/dashboard')).toBe(false)
    expect(isPathTrialExempt('/projects/abc')).toBe(false)
    expect(isPathTrialExempt('/projects/abc/documents/def')).toBe(false)
    expect(isPathTrialExempt('/admin')).toBe(false)
  })

  it('fails open (exempts) for null pathname — better than a redirect loop', () => {
    expect(isPathTrialExempt(null)).toBe(true)
  })
})
