/**
 * V1.x-B.2.3 — additional failure-classifier coverage.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §10 + lib/scheduler/failure-classifier.ts.
 *
 * The B.2.1 unit suite (v1x-b2-failure-classifier.test.ts) covers the
 * core classification table. This extras file adds coverage for cases
 * relevant to B.2.3:
 *   - Anthropic Batch API errors (per-request errored / expired / canceled)
 *   - the batch poller's mapping from Anthropic-side error types to
 *     our 5-class taxonomy
 */

import { describe, expect, it } from 'vitest'

import { classifyFailure, requiresUserSurface } from '@/lib/scheduler/failure-classifier'

describe('classifyFailure — Batch API errors (B.2.3)', () => {
  it('classifies an Anthropic 529 overloaded as Class A by default fallback', () => {
    // Anthropic returns 529 on overload — it's transient, retry-eligible.
    // Our classifier doesn't enumerate 529 explicitly; it falls through
    // to the HTTP 5xx default (Class A). Verify the contract.
    expect(classifyFailure({ operationType: 'expand', errorCode: 'overloaded', httpStatus: 529 })).toBe('A')
  })

  it('classifies invalid_request_error as Class D (validation)', () => {
    // Anthropic 400 with type 'invalid_request_error' — our request was
    // malformed. Falls through to HTTP 4xx default → D.
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'invalid_request_error', httpStatus: 400 })).toBe('D')
  })

  it('classifies authentication_error as Class D (validation: bad key)', () => {
    // Anthropic 401 with auth error. Falls through to HTTP 4xx default → D.
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'authentication_error', httpStatus: 401 })).toBe('D')
  })

  it('classifies api_error (anthropic-side internal) as Class A on 500', () => {
    // Anthropic 500 with type 'api_error' — their server-side issue, retry.
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'api_error', httpStatus: 500 })).toBe('A')
  })
})

describe('requiresUserSurface — boundary checks for batch failures', () => {
  it('Class A batch retries do NOT require user surface', () => {
    expect(requiresUserSurface('A')).toBe(false)
  })
  it('Class C bucket exhaustion does NOT require user surface (silent re-queue)', () => {
    expect(requiresUserSurface('C')).toBe(false)
  })
  it('Class D batch validation failure DOES require user surface', () => {
    expect(requiresUserSurface('D')).toBe(true)
  })
  it('Class E (e.g. missing config) DOES require operator action', () => {
    expect(requiresUserSurface('E')).toBe(true)
  })
})
