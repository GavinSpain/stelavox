/**
 * V1.x-B.2.1 — failure classifier unit tests.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §10.1 CK-4 +
 *         M-110 + lib/scheduler/failure-classifier.ts.
 *
 * Verifies the TS classifier produces the same outputs the M-110 SQL
 * function should produce. The TS path is the primary; the SQL path is
 * mirrored for the dispatcher's recovery sweep. End-to-end SQL parity
 * is verified by the Playwright spec at tests/v1x-b2/scheduler-substrate.spec.ts.
 */

import { describe, expect, it } from 'vitest'

import {
  classifyFailure,
  isAutoRetryable,
  requiresUserSurface,
} from '@/lib/scheduler/failure-classifier'

describe('classifyFailure — Class A (transient)', () => {
  it('classifies HTTP 408 as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'request_timeout', httpStatus: 408 })).toBe('A')
  })

  it('classifies plain HTTP 429 as A', () => {
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'rate_limited', httpStatus: 429 })).toBe('A')
  })

  it('classifies HTTP 502 as A', () => {
    expect(classifyFailure({ operationType: 'refine', errorCode: 'bad_gateway', httpStatus: 502 })).toBe('A')
  })

  it('classifies HTTP 503 as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'service_unavailable', httpStatus: 503 })).toBe('A')
  })

  it('classifies HTTP 504 as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'gateway_timeout', httpStatus: 504 })).toBe('A')
  })

  it('classifies network_reset as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'network_reset', httpStatus: 0 })).toBe('A')
  })

  it('classifies econnreset as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'econnreset', httpStatus: 0 })).toBe('A')
  })

  it('classifies body_parse_failure as A', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'body_parse_failure', httpStatus: 0 })).toBe('A')
  })

  it('classifies HTTP 500 as A by default fallback', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'unknown_5xx', httpStatus: 500 })).toBe('A')
  })

  it('classifies HTTP 599 as A by default fallback', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'unknown_5xx', httpStatus: 599 })).toBe('A')
  })
})

describe('classifyFailure — Class B (interrupted)', () => {
  it('classifies stop_requested as B', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'stop_requested', httpStatus: 0 })).toBe('B')
  })

  it('classifies cancelled_by_user as B', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'cancelled_by_user', httpStatus: 0 })).toBe('B')
  })

  it('classifies process_crash as B', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'process_crash', httpStatus: 0 })).toBe('B')
  })

  it('classifies recovery_sweep_reclaim as B', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'recovery_sweep_reclaim', httpStatus: 0 })).toBe('B')
  })

  it('classifies heartbeat_expired as B', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'heartbeat_expired', httpStatus: 0 })).toBe('B')
  })

  it('classifies client_disconnect as B', () => {
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'client_disconnect', httpStatus: 0 })).toBe('B')
  })

  it('returns B as conservative default for unrecognised inputs', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'something_truly_unknown', httpStatus: 0 })).toBe('B')
  })
})

describe('classifyFailure — Class C (capacity)', () => {
  it('classifies anthropic_concurrent_limit override on 429 as C', () => {
    expect(
      classifyFailure({
        operationType: 'director_iteration',
        errorCode: 'anthropic_concurrent_limit',
        httpStatus: 429,
      }),
    ).toBe('C')
  })

  it('classifies bucket_exhausted as C', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'bucket_exhausted', httpStatus: 0 })).toBe('C')
  })

  it('classifies capacity_unavailable as C', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'capacity_unavailable', httpStatus: 0 })).toBe('C')
  })

  it('classifies reservation_expired as C', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'reservation_expired', httpStatus: 0 })).toBe('C')
  })

  it('classifies requeue_patience_exhausted as C', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'requeue_patience_exhausted', httpStatus: 0 })).toBe('C')
  })
})

describe('classifyFailure — Class D (validation)', () => {
  it('classifies tool_input_invalid as D', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'tool_input_invalid', httpStatus: 400 })).toBe('D')
  })

  it('classifies output_schema_invalid as D', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'output_schema_invalid', httpStatus: 0 })).toBe('D')
  })

  it('classifies malformed_json as D', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'malformed_json', httpStatus: 0 })).toBe('D')
  })

  it('classifies canary_leak_detected as D', () => {
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'canary_leak_detected', httpStatus: 0 })).toBe('D')
  })

  it('classifies injection_blocked as D', () => {
    expect(classifyFailure({ operationType: 'synthesise', errorCode: 'injection_blocked', httpStatus: 0 })).toBe('D')
  })

  it('classifies h08_invariant_violation as D', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'h08_invariant_violation', httpStatus: 0 })).toBe('D')
  })

  it('classifies tool_result_size_exceeded as D', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'tool_result_size_exceeded', httpStatus: 0 })).toBe('D')
  })

  it('classifies max_iterations_reached as D', () => {
    expect(classifyFailure({ operationType: 'director_iteration', errorCode: 'max_iterations_reached', httpStatus: 0 })).toBe('D')
  })

  it('classifies HTTP 400 as D by default fallback', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'bad_request', httpStatus: 400 })).toBe('D')
  })

  it('classifies HTTP 422 as D by default fallback', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'unprocessable_entity', httpStatus: 422 })).toBe('D')
  })
})

describe('classifyFailure — Class E (hard system)', () => {
  it('classifies missing_config as E', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'missing_config', httpStatus: 0 })).toBe('E')
  })

  it('classifies missing_migration as E', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'missing_migration', httpStatus: 0 })).toBe('E')
  })

  it('classifies agent_profile_not_found as E', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'agent_profile_not_found', httpStatus: 0 })).toBe('E')
  })

  it('classifies job_missing_profile_or_node as E', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'job_missing_profile_or_node', httpStatus: 0 })).toBe('E')
  })

  it('classifies broken_db_constraint as E', () => {
    expect(classifyFailure({ operationType: 'expand', errorCode: 'broken_db_constraint', httpStatus: 0 })).toBe('E')
  })
})

describe('isAutoRetryable', () => {
  it('returns true for Class A within budget', () => {
    expect(isAutoRetryable('A', 0, 3)).toBe(true)
    expect(isAutoRetryable('A', 2, 3)).toBe(true)
  })

  it('returns false for Class A at budget', () => {
    expect(isAutoRetryable('A', 3, 3)).toBe(false)
  })

  it('returns false for non-A classes regardless of budget', () => {
    expect(isAutoRetryable('B', 0, 3)).toBe(false)
    expect(isAutoRetryable('C', 0, 3)).toBe(false)
    expect(isAutoRetryable('D', 0, 3)).toBe(false)
    expect(isAutoRetryable('E', 0, 3)).toBe(false)
  })
})

describe('requiresUserSurface', () => {
  it('returns false for silent classes A and C', () => {
    expect(requiresUserSurface('A')).toBe(false)
    expect(requiresUserSurface('C')).toBe(false)
  })

  it('returns true for B/D/E', () => {
    expect(requiresUserSurface('B')).toBe(true)
    expect(requiresUserSurface('D')).toBe(true)
    expect(requiresUserSurface('E')).toBe(true)
  })
})
