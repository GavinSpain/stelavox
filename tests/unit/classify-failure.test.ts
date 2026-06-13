/**
 * Phase 9.E (DR-020) — classifyFailure deterministic mapping.
 *
 * The classifier is the core of the FailureSurface adoption: HTTP status
 * + error code → failure class. Two statuses are deliberately excluded
 * (dedicated surfaces own them).
 */

import { describe, expect, it } from 'vitest'

import { classifyFailure } from '@/lib/ui/classifyFailure'

describe('classifyFailure', () => {
  it('network error (null status) → Class E banner', () => {
    expect(classifyFailure(null)).toEqual({ classKind: 'E', surface: 'banner' })
  })

  it('429 → Class A toast (transient)', () => {
    expect(classifyFailure(429)).toEqual({ classKind: 'A', surface: 'toast' })
  })

  it('503 → Class A toast (transient)', () => {
    expect(classifyFailure(503)).toEqual({ classKind: 'A', surface: 'toast' })
  })

  it('402 budget → Class D banner (with remediation)', () => {
    expect(classifyFailure(402, 'token_budget_exceeded')).toEqual({
      classKind: 'D',
      surface: 'banner',
    })
  })

  it('generic 4xx → Class D banner', () => {
    expect(classifyFailure(400)).toEqual({ classKind: 'D', surface: 'banner' })
    expect(classifyFailure(404)).toEqual({ classKind: 'D', surface: 'banner' })
  })

  it('5xx → Class E banner (hard system)', () => {
    expect(classifyFailure(500)).toEqual({ classKind: 'E', surface: 'banner' })
    expect(classifyFailure(502)).toEqual({ classKind: 'E', surface: 'banner' })
  })

  it('423 locked → null (DR-046 dedicated surface owns it)', () => {
    expect(classifyFailure(423)).toBeNull()
    expect(classifyFailure(423, 'node_locked')).toBeNull()
  })

  it('422 injection_blocked → null (DR-050 dedicated surface owns it)', () => {
    expect(classifyFailure(422, 'injection_blocked')).toBeNull()
  })

  it('422 with a NON-injection error code → Class D banner (validation)', () => {
    expect(classifyFailure(422, 'invalid_body')).toEqual({
      classKind: 'D',
      surface: 'banner',
    })
  })

  it('2xx / 3xx → null (not a failure)', () => {
    expect(classifyFailure(200)).toBeNull()
    expect(classifyFailure(302)).toBeNull()
  })
})
