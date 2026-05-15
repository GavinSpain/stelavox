-- Migration 115 — V1.x-B.2.2: dispatcher_tick_samples table.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §4.2.1 M-115 +
--         §7 (cross-cutting metrics layer) + Director Architecture v2.0 §17.
--
-- Per-tick observability. The dispatcher writes one row per tick
-- summarising: how many tickets were considered, how many dispatched,
-- skip reasons (no capacity / no dependency / wrong route /
-- stop_requested), per-class queue depth, current virtual_clock, Class 1
-- reserved-slot utilisation, active throttle reservations.
--
-- Retention: 7 days raw. M-125 (B.2.4) lands the daily purge. The
-- minute-level rollup (metrics_minute_buckets via M-124) preserves
-- long-term aggregates for V1.x-E admin dashboard queries.

CREATE TABLE dispatcher_tick_samples (
  id BIGSERIAL PRIMARY KEY,
  tick_started_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,
  tickets_considered INTEGER NOT NULL,
  tickets_dispatched INTEGER NOT NULL,
  tickets_skipped_no_capacity INTEGER NOT NULL,
  tickets_skipped_no_dependency INTEGER NOT NULL,
  tickets_skipped_wrong_route INTEGER NOT NULL,
  tickets_skipped_stop_requested INTEGER NOT NULL,
  queue_depth_class_1 INTEGER NOT NULL,
  queue_depth_class_2 INTEGER NOT NULL,
  queue_depth_class_3 INTEGER NOT NULL,
  queue_depth_class_4 INTEGER NOT NULL,
  virtual_clock NUMERIC(20,6) NOT NULL,
  class_1_reserved_slots_in_use INTEGER NOT NULL,
  active_throttle_reservations_count INTEGER NOT NULL
);

-- Time-descending index for the admin dashboard's "last N minutes" view.
CREATE INDEX dispatcher_tick_samples_time_idx
  ON dispatcher_tick_samples(tick_started_at DESC);

ALTER TABLE dispatcher_tick_samples ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only_dispatcher_tick_samples" ON dispatcher_tick_samples
  FOR ALL USING (FALSE);
