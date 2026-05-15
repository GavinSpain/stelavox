-- Migration 112 — V1.x-B.2.2: user_throttle_buckets table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-112 +
--         Director Architecture v2.0 §9.6 (per-user buckets).
--
-- Per-pool token bucket. pool_key namespaces:
--   'platform'        — the shared platform Anthropic key bucket
--   'byok:<user_id>'  — per-user BYOK key bucket
--
-- Lazy refill: refill happens at read time inside the dispatcher's
-- transaction (FOR UPDATE on the bucket row), not by a background
-- timer. Formula:
--   current = min(bucket_size, current_tokens + (now - last_refill_at) * refill_rate)
--
-- Reservation lifecycle (full impl in lib/scheduler/buckets.ts):
--   1. checkAndReserve(tx, poolKey, estimatedTokens, agentJobId):
--      - SELECT FOR UPDATE on bucket row
--      - lazy refill
--      - if current < estimatedTokens: return { reserved:false, reason:'insufficient_tokens' }
--      - else: deduct estimatedTokens; INSERT throttle_reservations row
--   2. reconcile(poolKey, agentJobId, actualTokens):
--      - delta = estimated - actual
--      - refund (or further deduct) the difference
--      - DELETE the reservation row
--   3. refundExpired() (recovery sweep):
--      - find expired throttle_reservations (existing M-095 table)
--      - refund their estimated_tokens to the bucket
--      - mark them released
--
-- Default 'platform' row inserted by this migration with bucket_size +
-- refill_rate sourced from M-114's platform_config defaults. BYOK rows
-- are inserted on first dispatch for that user (UPSERT in the
-- dispatcher) — keeps the table small for unused users.

CREATE TABLE user_throttle_buckets (
  pool_key TEXT PRIMARY KEY,
  bucket_size INTEGER NOT NULL CHECK (bucket_size > 0),
  refill_rate NUMERIC(20,6) NOT NULL CHECK (refill_rate >= 0),
  current_tokens NUMERIC(20,6) NOT NULL,
  last_refill_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX user_throttle_buckets_updated_idx
  ON user_throttle_buckets(updated_at DESC);

-- Seed the platform bucket with a placeholder size + rate. M-114
-- platform_config keys carry the canonical defaults; the dispatcher's
-- upsertDefaultBucket helper consults those keys on first read and
-- backfills.
INSERT INTO user_throttle_buckets (pool_key, bucket_size, refill_rate, current_tokens)
VALUES ('platform', 200000, 666.67, 200000);

-- Service-role only — the dispatcher writes; the admin dashboard reads
-- via metrics_minute_buckets aggregates (V1.x-E).
ALTER TABLE user_throttle_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_user_throttle_buckets" ON user_throttle_buckets
  FOR ALL USING (FALSE);
