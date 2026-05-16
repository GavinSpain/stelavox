-- V1.x-E.1 — admin alert thresholds in platform_config + extend the
-- raw-samples purge to cover anthropic_rate_limit_samples.
--
-- Source: Component Spec §17.5 §6 (capacity alerts) ·
-- wireframe_admin_dashboard_v1.html §05 M-145.
--
-- The alert engine evaluates these thresholds at /admin page-load
-- (no separate evaluator cron in V1.x-E — push notifications are V2).
-- Each threshold pair is `<metric>_warn_pct` (the utilisation crossover)
-- + `<metric>_sustained_minutes` (how long it must hold to alert).
--
-- Also extends purge_raw_metric_samples (M-125) to drop
-- anthropic_rate_limit_samples rows older than 7 days, matching the
-- existing dispatcher_tick_samples + route_capacity_samples retention.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'admin.alerts.itpm_warn_pct',
    '75',
    'V1.x-E — Anthropic ITPM utilisation %% triggering a capacity alert when sustained for itpm_sustained_minutes.',
    'integer'
  ),
  (
    'admin.alerts.itpm_sustained_minutes',
    '10',
    'V1.x-E — Minutes ITPM must remain above warn_pct before an alert surfaces.',
    'integer'
  ),
  (
    'admin.alerts.queue_oldest_warn_minutes',
    '15',
    'V1.x-E — Minutes since oldest queued job''s queued_at; triggers Class-4 starvation alert when exceeded.',
    'integer'
  ),
  (
    'admin.alerts.failure_rate_warn_pct',
    '15',
    'V1.x-E — Failure rate %% in the recent window; triggers a quality-degradation alert when exceeded.',
    'integer'
  )
ON CONFLICT (key) DO NOTHING;

-- Extend the existing purge function to cover the new sample table.
-- Idempotent: CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION purge_raw_metric_samples()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_dispatcher_purged INTEGER;
  v_route_purged INTEGER;
  v_failure_purged INTEGER;
  v_buckets_purged INTEGER;
  v_rate_limit_purged INTEGER;
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

  -- V1.x-E.1 addition.
  DELETE FROM anthropic_rate_limit_samples
  WHERE sampled_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS v_rate_limit_purged = ROW_COUNT;

  RETURN jsonb_build_object(
    'dispatcher_tick_samples_purged', v_dispatcher_purged,
    'route_capacity_samples_purged', v_route_purged,
    'failure_taxonomy_samples_purged', v_failure_purged,
    'metrics_minute_buckets_purged', v_buckets_purged,
    'anthropic_rate_limit_samples_purged', v_rate_limit_purged
  );
END;
$$;

REVOKE ALL ON FUNCTION purge_raw_metric_samples() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_raw_metric_samples() TO service_role;

-- pg_cron schedule for purge_raw_metric_samples already exists from
-- M-125 (daily at 04:00 UTC); it picks up the new DELETE on next run.
