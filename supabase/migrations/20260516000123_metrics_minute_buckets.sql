-- Migration 123 — V1.x-B.2.4: metrics_minute_buckets table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §6.2.2 M-123 + §7.
--
-- Per-minute aggregation of dispatcher_tick_samples + route_capacity_samples
-- + failure_taxonomy_samples. The admin dashboard (V1.x-E) reads from this
-- table for fast queries; raw samples are retained for 7-30 days for
-- incident drill-down.
--
-- metric_kind is a free-text discriminator (kept generic so future
-- metrics don't need ENUM migrations):
--   'queue_depth' — per-class queue depth at sample time
--   'dispatch_rate' — tickets dispatched per minute, per class
--   'failure_rate' — failures per minute, per class
--   'cost_rate' — cost_credits accumulated per minute, per pool/op_type
--   'bucket_utilisation' — (current_tokens / bucket_size) avg per pool
--   'p50_wait_ms' / 'p95_wait_ms' / 'p99_wait_ms' — dispatched_at - queued_at
--                                                    percentiles per class
--   'auto_recovery_rate' — Class A retries succeeding / total Class A
--   ... (V1.x-E adds more as needed)
--
-- dimensions JSONB carries the per-metric breakdown shape:
--   queue_depth → {"class": 1}
--   dispatch_rate → {"class": 1, "pool_key": "platform"}
--   failure_rate → {"class": "A", "operation_type": "synthesise"}
--   cost_rate → {"pool_key": "byok:abc...", "operation_type": "expand"}
--
-- The PRIMARY KEY (bucket_started_at, metric_kind, dimensions) makes
-- the M-124 rollup ON CONFLICT idempotent — re-running the rollup for
-- a given minute updates rather than duplicates.

CREATE TABLE metrics_minute_buckets (
  bucket_started_at TIMESTAMPTZ NOT NULL,
  metric_kind TEXT NOT NULL,
  dimensions JSONB NOT NULL,
  value NUMERIC(20,6) NOT NULL,
  sample_count INTEGER NOT NULL,
  PRIMARY KEY (bucket_started_at, metric_kind, dimensions)
);

CREATE INDEX metrics_minute_buckets_kind_time_idx
  ON metrics_minute_buckets(metric_kind, bucket_started_at DESC);

CREATE INDEX metrics_minute_buckets_time_idx
  ON metrics_minute_buckets(bucket_started_at DESC);

ALTER TABLE metrics_minute_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_metrics_minute_buckets" ON metrics_minute_buckets
  FOR ALL USING (FALSE);
