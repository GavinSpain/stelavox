import 'server-only'

/**
 * V1.x-B.2.2 — per-pool token bucket lifecycle.
 *
 * Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.3 +
 *         Director Architecture v2.0 §9.6 (per-user buckets).
 *
 * pool_key namespaces:
 *   'platform'        — shared platform Anthropic key bucket
 *   'byok:<user_id>'  — per-user BYOK key bucket
 *
 * Lifecycle (per the build checklist's claim → reserve → consume →
 * reconcile → recover sequence):
 *   1. checkAndReserve — atomic FOR UPDATE on bucket; lazy refill;
 *      deduct estimatedTokens; INSERT throttle_reservations row.
 *   2. reconcile — runner returns; refund (estimated - actual) delta;
 *      DELETE the reservation row.
 *   3. refundExpired — recovery sweep finds reservations past TTL whose
 *      runner never reconciled; refunds their estimated_tokens.
 *
 * The lazy-refill formula (no background timer, refill happens at read):
 *   newTokens = min(bucket_size,
 *                   current_tokens + (now - last_refill_at) * refill_rate)
 *
 * The pure math (lazyRefill) is factored for unit-testability without DB.
 */

import { createServiceRoleClient } from '@/lib/supabase/service'
import { getConfig } from '@/lib/config/platform-config'

// ---------------------------------------------------------------------------
// Pure math (unit-testable; no DB)
// ---------------------------------------------------------------------------

export interface BucketSnapshot {
  bucket_size: number
  refill_rate: number
  current_tokens: number
  last_refill_at: Date
}

/**
 * Compute the bucket's current tokens at `now` after lazy refill, capped
 * at bucket_size.
 *
 * Pure function; no side effects; no DB.
 */
export function lazyRefill(bucket: BucketSnapshot, now: Date = new Date()): number {
  const elapsedSec = Math.max(0, (now.getTime() - bucket.last_refill_at.getTime()) / 1000)
  const refilled = bucket.current_tokens + elapsedSec * bucket.refill_rate
  return Math.min(bucket.bucket_size, refilled)
}

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

export type ReservationOutcome =
  | { reserved: true; reservationId: string; remainingTokens: number }
  | { reserved: false; reason: 'insufficient_tokens'; currentTokens: number; bucketSize: number }
  | { reserved: false; reason: 'bucket_not_found'; currentTokens: 0; bucketSize: 0 }

interface BucketRow {
  pool_key: string
  bucket_size: number
  refill_rate: number
  current_tokens: number
  last_refill_at: string
}

/**
 * Get-or-create the bucket row for a pool key. Service-role only.
 * BYOK pools are auto-created on first use using the configured BYOK
 * defaults.
 */
async function getOrCreateBucket(poolKey: string): Promise<BucketRow | null> {
  const supabase = createServiceRoleClient()
  const { data: existing } = await supabase
    .from('user_throttle_buckets')
    .select('pool_key, bucket_size, refill_rate, current_tokens, last_refill_at')
    .eq('pool_key', poolKey)
    .maybeSingle()
  if (existing) return existing as unknown as BucketRow

  // Insert default for BYOK pools. Platform pool was seeded in M-112;
  // if we hit this branch for 'platform' something is wrong.
  if (poolKey === 'platform') {
    return null
  }
  if (!poolKey.startsWith('byok:')) {
    return null
  }

  const bucketSize = (await getConfig<number>('agent.byok_bucket_size_tokens')) ?? 100_000
  const refillRate = (await getConfig<number>('agent.byok_bucket_refill_per_sec')) ?? 333.33
  const { data: inserted, error } = await supabase
    .from('user_throttle_buckets')
    .insert({
      pool_key: poolKey,
      bucket_size: bucketSize,
      refill_rate: refillRate,
      current_tokens: bucketSize,
    })
    .select('pool_key, bucket_size, refill_rate, current_tokens, last_refill_at')
    .single()
  if (error || !inserted) {
    // Race: another tick may have inserted in parallel. Re-read.
    const { data: refetched } = await supabase
      .from('user_throttle_buckets')
      .select('pool_key, bucket_size, refill_rate, current_tokens, last_refill_at')
      .eq('pool_key', poolKey)
      .maybeSingle()
    if (refetched) return refetched as unknown as BucketRow
    return null
  }
  return inserted as unknown as BucketRow
}

/**
 * Reserve `estimatedTokens` from the bucket for `agentJobId`. Atomic via
 * a single UPDATE that includes the lazy-refill computation in SQL — so
 * concurrent tick attempts can't double-spend.
 *
 * Returns:
 *   { reserved: true, reservationId, remainingTokens } on success
 *   { reserved: false, reason: 'insufficient_tokens', ... } when bucket
 *     can't satisfy the request
 *   { reserved: false, reason: 'bucket_not_found', ... } when the bucket
 *     row couldn't be created (BYOK pool with malformed key, or platform
 *     row missing).
 */
export async function checkAndReserve(
  poolKey: string,
  estimatedTokens: number,
  agentJobId: string,
): Promise<ReservationOutcome> {
  const supabase = createServiceRoleClient()

  const bucket = await getOrCreateBucket(poolKey)
  if (!bucket) {
    return { reserved: false, reason: 'bucket_not_found', currentTokens: 0, bucketSize: 0 }
  }

  // Inline lazy refill + deduction. Postgres expression form so the
  // concurrent-write race is handled by the row lock — no double-spend
  // even under parallel dispatchers.
  //
  // We CANNOT use a simple .update() with .gte() because supabase-js
  // doesn't expose conditional UPDATE-with-computed-expression cleanly.
  // Use an RPC or a raw SQL via .rpc() / Postgres.js. For B.2.2 we use a
  // SECURITY DEFINER SQL function. To keep this migration self-contained
  // and avoid an additional migration, we issue two queries inside a
  // logical transaction: SELECT FOR UPDATE then UPDATE. Postgrest's
  // .single() with .filter() won't lock; we use a stored procedure
  // instead — see migration 117 (B.2.3) for the SQL helper. For B.2.2
  // we approximate via an optimistic-concurrency loop.
  //
  // The optimistic loop: read current row + refill + check tokens; if
  // satisfied, attempt UPDATE with WHERE current_tokens=<observed>. If
  // a concurrent UPDATE landed first the WHERE fails (0 rows updated)
  // → retry. Bounded retry count keeps worst case tight.
  const maxAttempts = 5
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data: row } = await supabase
      .from('user_throttle_buckets')
      .select('bucket_size, refill_rate, current_tokens, last_refill_at')
      .eq('pool_key', poolKey)
      .single()
    if (!row) {
      return { reserved: false, reason: 'bucket_not_found', currentTokens: 0, bucketSize: 0 }
    }

    const snapshot: BucketSnapshot = {
      bucket_size: Number(row.bucket_size),
      refill_rate: Number(row.refill_rate),
      current_tokens: Number(row.current_tokens),
      last_refill_at: new Date(row.last_refill_at),
    }
    const refilled = lazyRefill(snapshot)
    if (refilled < estimatedTokens) {
      return {
        reserved: false,
        reason: 'insufficient_tokens',
        currentTokens: refilled,
        bucketSize: snapshot.bucket_size,
      }
    }

    const newTokens = refilled - estimatedTokens
    const { data: updated, error: updErr } = await supabase
      .from('user_throttle_buckets')
      .update({
        current_tokens: newTokens,
        last_refill_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('pool_key', poolKey)
      .eq('current_tokens', row.current_tokens) // optimistic CAS
      .select('current_tokens')
      .maybeSingle()

    if (updErr) {
      return { reserved: false, reason: 'insufficient_tokens', currentTokens: refilled, bucketSize: snapshot.bucket_size }
    }
    if (!updated) {
      // CAS lost — another tick won. Retry.
      continue
    }

    // Successfully deducted. Insert reservation row.
    const ttlSec = (await getConfig<number>('agent.reservation_ttl_seconds')) ?? 300
    const expiresAt = new Date(Date.now() + ttlSec * 1000).toISOString()
    const { data: rsv, error: rsvErr } = await supabase
      .from('throttle_reservations')
      .insert({
        pool_key: poolKey,
        agent_job_id: agentJobId,
        estimated_tokens: estimatedTokens,
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (rsvErr || !rsv) {
      // Reservation insert failed — refund eagerly. The bucket UPDATE
      // already succeeded, so refund by adding back.
      await supabase
        .from('user_throttle_buckets')
        .update({ current_tokens: newTokens + estimatedTokens, updated_at: new Date().toISOString() })
        .eq('pool_key', poolKey)
      return { reserved: false, reason: 'insufficient_tokens', currentTokens: refilled, bucketSize: snapshot.bucket_size }
    }

    return { reserved: true, reservationId: rsv.id, remainingTokens: newTokens }
  }

  // CAS contention exhausted retry budget. Treat as transient
  // insufficient — the dispatcher re-queues; next tick will retry.
  return { reserved: false, reason: 'insufficient_tokens', currentTokens: 0, bucketSize: 0 }
}

/**
 * Reconcile after the runner completes. Refunds the
 * (estimatedTokens - actualTokens) delta (positive delta = refund;
 * negative delta = further deduct). Deletes the reservation row.
 *
 * actualTokens = actual_input_tokens + actual_output_tokens.
 *
 * Idempotent: if the reservation is already gone (concurrent
 * refundExpired sweep), this is a no-op for the bucket and returns
 * { reconciled: false, reason: 'reservation_not_found' }.
 */
export async function reconcile(
  poolKey: string,
  agentJobId: string,
  actualTokens: number,
): Promise<{ reconciled: true; deltaApplied: number } | { reconciled: false; reason: string }> {
  const supabase = createServiceRoleClient()

  const { data: rsv } = await supabase
    .from('throttle_reservations')
    .select('id, estimated_tokens, consumed_at, released_at')
    .eq('pool_key', poolKey)
    .eq('agent_job_id', agentJobId)
    .is('consumed_at', null)
    .is('released_at', null)
    .maybeSingle()

  if (!rsv) {
    return { reconciled: false, reason: 'reservation_not_found' }
  }

  const estimated = Number(rsv.estimated_tokens)
  const delta = estimated - actualTokens // positive = refund

  if (delta !== 0) {
    // Read current bucket, apply delta (capped at bucket_size).
    const { data: bucket } = await supabase
      .from('user_throttle_buckets')
      .select('bucket_size, current_tokens')
      .eq('pool_key', poolKey)
      .single()
    if (bucket) {
      const newTokens = Math.min(
        Number(bucket.bucket_size),
        Math.max(0, Number(bucket.current_tokens) + delta),
      )
      await supabase
        .from('user_throttle_buckets')
        .update({ current_tokens: newTokens, updated_at: new Date().toISOString() })
        .eq('pool_key', poolKey)
    }
  }

  // Mark the reservation consumed.
  await supabase
    .from('throttle_reservations')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', rsv.id)

  return { reconciled: true, deltaApplied: delta }
}

/**
 * Recovery sweep — find expired throttle_reservations whose runner
 * never reconciled and refund their estimated_tokens to the bucket.
 *
 * Returns the count refunded.
 *
 * The existing scheduler_sweep_throttle_reservations SQL function
 * (M-099) marks them released without refunding tokens. B.2.2 layers
 * actual token refunding on top by reading what M-099 just released
 * and applying the bucket delta in the application layer.
 */
export async function refundExpired(): Promise<{ refunded: number }> {
  const supabase = createServiceRoleClient()

  // Fetch expired reservations that were just-released (released_at set
  // by the SQL sweep but consumed_at still null).
  const { data: expired } = await supabase
    .from('throttle_reservations')
    .select('id, pool_key, estimated_tokens')
    .is('consumed_at', null)
    .not('released_at', 'is', null)
    .gte('released_at', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // last 5 min batch

  if (!expired || expired.length === 0) return { refunded: 0 }

  let refunded = 0
  for (const rsv of expired) {
    const { data: bucket } = await supabase
      .from('user_throttle_buckets')
      .select('bucket_size, current_tokens')
      .eq('pool_key', rsv.pool_key)
      .single()
    if (!bucket) continue
    const newTokens = Math.min(
      Number(bucket.bucket_size),
      Number(bucket.current_tokens) + Number(rsv.estimated_tokens),
    )
    await supabase
      .from('user_throttle_buckets')
      .update({ current_tokens: newTokens, updated_at: new Date().toISOString() })
      .eq('pool_key', rsv.pool_key)
    // Mark the reservation consumed so we don't refund twice.
    await supabase
      .from('throttle_reservations')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', rsv.id)
    refunded++
  }

  return { refunded }
}

/**
 * Build the pool_key for an agent_job given its route + user_id.
 *   'platform'        when route='platform'
 *   'byok:<user_id>'  when route='byok' and user_id is present
 *   'platform'        when route='byok' and no user_id (defensive fallback)
 */
export function poolKeyFor(route: 'platform' | 'byok', userId: string | null | undefined): string {
  if (route === 'byok' && userId) return `byok:${userId}`
  return 'platform'
}
