-- Migration 124 — V1.x-B.2.4: metrics_minute_rollup pg_cron + SQL aggregation.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §6.2.2 M-124.
--
-- pg_cron job runs every minute that aggregates the prior minute's
-- dispatcher_tick_samples + route_capacity_samples + failure_taxonomy_samples
-- into metrics_minute_buckets rows.
--
-- Rollups computed:
--   queue_depth (per class)        — avg over the minute's tick samples
--   dispatch_rate (per class)      — sum of tickets_dispatched per class
--   bucket_utilisation (per pool)  — avg current_tokens / bucket_size
--   failure_rate (per class)       — count of failures per class
--   auto_recovery_rate             — auto_recovered / total Class A
--
-- Atomic INSERT ... ON CONFLICT DO UPDATE so re-runs are idempotent.

CREATE OR REPLACE FUNCTION rollup_metrics_minute(
  p_bucket_started_at TIMESTAMPTZ DEFAULT NULL
) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bucket TIMESTAMPTZ;
  v_inserted INTEGER := 0;
BEGIN
  -- Default: roll up the prior minute (truncated to minute boundary).
  v_bucket := COALESCE(p_bucket_started_at, date_trunc('minute', NOW() - INTERVAL '1 minute'));

  -- 1. queue_depth per class (avg over minute's tick samples).
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  SELECT
    v_bucket,
    'queue_depth',
    jsonb_build_object('class', cls.class),
    AVG(
      CASE cls.class
        WHEN 1 THEN dts.queue_depth_class_1
        WHEN 2 THEN dts.queue_depth_class_2
        WHEN 3 THEN dts.queue_depth_class_3
        WHEN 4 THEN dts.queue_depth_class_4
      END
    ),
    COUNT(*)
  FROM dispatcher_tick_samples dts
  CROSS JOIN (VALUES (1), (2), (3), (4)) AS cls(class)
  WHERE dts.tick_started_at >= v_bucket
    AND dts.tick_started_at < v_bucket + INTERVAL '1 minute'
  GROUP BY cls.class
  HAVING COUNT(*) > 0
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  -- 2. dispatch_rate per class (sum of tickets_dispatched).
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  SELECT
    v_bucket,
    'dispatch_rate',
    jsonb_build_object('window', '1min'),
    SUM(tickets_dispatched),
    COUNT(*)
  FROM dispatcher_tick_samples
  WHERE tick_started_at >= v_bucket
    AND tick_started_at < v_bucket + INTERVAL '1 minute'
  HAVING COUNT(*) > 0
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count;

  -- 3. bucket_utilisation per pool (avg current_tokens / bucket_size).
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  SELECT
    v_bucket,
    'bucket_utilisation',
    jsonb_build_object('pool_key', pool_key),
    AVG(current_tokens / NULLIF(bucket_size, 0)),
    COUNT(*)
  FROM route_capacity_samples
  WHERE sampled_at >= v_bucket
    AND sampled_at < v_bucket + INTERVAL '1 minute'
  GROUP BY pool_key
  HAVING COUNT(*) > 0
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count;

  -- 4. failure_rate per class.
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  SELECT
    v_bucket,
    'failure_rate',
    jsonb_build_object('class', failure_class),
    COUNT(*),
    COUNT(*)
  FROM failure_taxonomy_samples
  WHERE occurred_at >= v_bucket
    AND occurred_at < v_bucket + INTERVAL '1 minute'
  GROUP BY failure_class
  HAVING COUNT(*) > 0
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count;

  -- 5. auto_recovery_rate (Class A retries succeeding / total Class A).
  --    Only emitted when there were Class A failures in the minute.
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  SELECT
    v_bucket,
    'auto_recovery_rate',
    jsonb_build_object('window', '1min'),
    SUM(CASE WHEN auto_recovered THEN 1 ELSE 0 END)::NUMERIC / NULLIF(COUNT(*), 0),
    COUNT(*)
  FROM failure_taxonomy_samples
  WHERE occurred_at >= v_bucket
    AND occurred_at < v_bucket + INTERVAL '1 minute'
    AND failure_class = 'A'
  HAVING COUNT(*) > 0
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = EXCLUDED.value, sample_count = EXCLUDED.sample_count;

  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION rollup_metrics_minute(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rollup_metrics_minute(TIMESTAMPTZ) TO service_role;

-- Schedule the rollup every minute (after the route_capacity_sampler
-- has had a chance to write its row for the prior minute).
SELECT cron.schedule(
  'metrics_minute_rollup',
  '* * * * *',
  $$SELECT rollup_metrics_minute();$$
);
