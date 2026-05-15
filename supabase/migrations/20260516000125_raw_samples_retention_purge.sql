-- Migration 125 — V1.x-B.2.4: raw samples retention purge pg_cron.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §6.2.2 M-125 + §7.
--
-- Daily purge of raw sample tables to keep storage bounded:
--   dispatcher_tick_samples  — 7 days
--   route_capacity_samples   — 7 days
--   failure_taxonomy_samples — 30 days (longer retention; rare events,
--                              useful for incident forensics)
--   metrics_minute_buckets   — 90 days (the pre-aggregated long-term
--                              series the admin dashboard reads)
--
-- The raw samples are retained shorter than the rollups because raw
-- data is high-volume but rollups are query-friendly. Drill-down to
-- raw samples for incident forensics works for the most-recent week
-- (or month for failure_taxonomy_samples).

CREATE OR REPLACE FUNCTION purge_raw_metric_samples()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatcher_purged INTEGER;
  v_route_purged INTEGER;
  v_failure_purged INTEGER;
  v_buckets_purged INTEGER;
BEGIN
  DELETE FROM dispatcher_tick_samples
  WHERE tick_started_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_dispatcher_purged = ROW_COUNT;

  DELETE FROM route_capacity_samples
  WHERE sampled_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_route_purged = ROW_COUNT;

  DELETE FROM failure_taxonomy_samples
  WHERE occurred_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS v_failure_purged = ROW_COUNT;

  DELETE FROM metrics_minute_buckets
  WHERE bucket_started_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS v_buckets_purged = ROW_COUNT;

  RETURN jsonb_build_object(
    'dispatcher_tick_samples_purged', v_dispatcher_purged,
    'route_capacity_samples_purged', v_route_purged,
    'failure_taxonomy_samples_purged', v_failure_purged,
    'metrics_minute_buckets_purged', v_buckets_purged
  );
END;
$$;

REVOKE ALL ON FUNCTION purge_raw_metric_samples() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_raw_metric_samples() TO service_role;

-- Schedule daily at 04:00 UTC (low-traffic window).
SELECT cron.schedule(
  'purge_raw_metric_samples',
  '0 4 * * *',
  $$SELECT purge_raw_metric_samples();$$
);
