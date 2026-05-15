-- Migration 116 — V1.x-B.2.2: route_capacity_samples table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-116 +
--         §7 (cross-cutting metrics layer).
--
-- Per-pool, per-minute snapshot of bucket utilisation. The
-- metrics-samplers cron writes one row per active pool per minute (or
-- on bucket exhaustion event, whichever comes first).
--
-- pool_key matches user_throttle_buckets.pool_key:
--   'platform'        — shared platform Anthropic key
--   'byok:<user_id>'  — per-user BYOK key
--
-- Retention: 7 days raw (M-125 B.2.4 daily purge). Rolled into
-- metrics_minute_buckets for long-term retention.

CREATE TABLE route_capacity_samples (
  id BIGSERIAL PRIMARY KEY,
  sampled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pool_key TEXT NOT NULL,
  current_tokens NUMERIC(20,6) NOT NULL,
  bucket_size INTEGER NOT NULL,
  refill_rate NUMERIC(20,6) NOT NULL,
  active_concurrent_calls INTEGER NOT NULL
);

CREATE INDEX route_capacity_samples_pool_time_idx
  ON route_capacity_samples(pool_key, sampled_at DESC);

ALTER TABLE route_capacity_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_route_capacity_samples" ON route_capacity_samples
  FOR ALL USING (FALSE);
