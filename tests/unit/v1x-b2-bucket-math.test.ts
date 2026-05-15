/**
 * V1.x-B.2.2 — bucket math unit tests (CK-8 substrate).
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §10.1 +
 *         lib/scheduler/buckets.ts.
 *
 * Tests the pure lazy-refill math without DB. Lifecycle correctness
 * (CK-9 / CK-10 / CK-12) is verified at scale in
 * tests/v1x-b2/bucket-lifecycle.spec.ts.
 */

import { describe, expect, it } from 'vitest'

import { lazyRefill, poolKeyFor, type BucketSnapshot } from '@/lib/scheduler/buckets'

describe('lazyRefill', () => {
  const now = new Date('2026-05-16T01:00:00Z')

  it('returns current_tokens when no time has elapsed', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 666.67,
      current_tokens: 50_000,
      last_refill_at: now,
    }
    expect(lazyRefill(bucket, now)).toBe(50_000)
  })

  it('refills at refill_rate * elapsed_seconds', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 666.67,
      current_tokens: 50_000,
      last_refill_at: new Date(now.getTime() - 30_000), // 30s ago
    }
    // Expected: 50000 + 30 * 666.67 = 50000 + 20000.1 = 70000.1
    const result = lazyRefill(bucket, now)
    expect(result).toBeCloseTo(70_000.1, 1)
  })

  it('caps at bucket_size when refill would exceed it', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 666.67,
      current_tokens: 199_000,
      last_refill_at: new Date(now.getTime() - 60_000), // 60s ago = 40000 tokens
    }
    expect(lazyRefill(bucket, now)).toBe(200_000)
  })

  it('returns current_tokens when refill_rate is zero', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 0,
      current_tokens: 50_000,
      last_refill_at: new Date(now.getTime() - 60_000),
    }
    expect(lazyRefill(bucket, now)).toBe(50_000)
  })

  it('returns current_tokens when last_refill_at is in the future (clock skew defensive)', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 666.67,
      current_tokens: 50_000,
      last_refill_at: new Date(now.getTime() + 60_000),
    }
    // elapsedSec is clamped to >=0 so the refill is 0.
    expect(lazyRefill(bucket, now)).toBe(50_000)
  })

  it('handles fractional second elapsed correctly', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 1000,
      current_tokens: 50_000,
      last_refill_at: new Date(now.getTime() - 500), // 0.5s ago
    }
    expect(lazyRefill(bucket, now)).toBe(50_500)
  })

  it('handles very large elapsed times by capping at bucket_size', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 200_000,
      refill_rate: 666.67,
      current_tokens: 0,
      last_refill_at: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days
    }
    expect(lazyRefill(bucket, now)).toBe(200_000)
  })

  it('zero-size bucket always returns 0', () => {
    const bucket: BucketSnapshot = {
      bucket_size: 0,
      refill_rate: 666.67,
      current_tokens: 0,
      last_refill_at: new Date(now.getTime() - 60_000),
    }
    expect(lazyRefill(bucket, now)).toBe(0)
  })
})

describe('poolKeyFor', () => {
  it('returns "platform" for route="platform" regardless of user_id', () => {
    expect(poolKeyFor('platform', null)).toBe('platform')
    expect(poolKeyFor('platform', 'user-uuid')).toBe('platform')
    expect(poolKeyFor('platform', undefined)).toBe('platform')
  })

  it('returns "byok:<user_id>" for route="byok" with user_id', () => {
    expect(poolKeyFor('byok', '11111111-1111-1111-1111-111111111111')).toBe(
      'byok:11111111-1111-1111-1111-111111111111',
    )
  })

  it('falls back to "platform" for route="byok" without user_id (defensive)', () => {
    expect(poolKeyFor('byok', null)).toBe('platform')
    expect(poolKeyFor('byok', undefined)).toBe('platform')
  })
})
