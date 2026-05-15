-- V1.x-C.4 — period rollover function + daily pg_cron.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §5 + §2 C.4.
--
-- The V1.x-C.2 admission gate reads organisations.token_usage_credits
-- against token_allocation_credits. Without a rollover, the usage
-- counter accumulates forever and orgs hit their cap after one period
-- with no recovery path. This function does the daily reset:
--
--   For each org whose current_period_start + plan.period_length_days
--   <= NOW(), zero token_usage_credits and advance current_period_start
--   by one period_length.
--
-- The cron runs daily at 03:00 UTC. The Director's traffic is unlikely
-- to fall before 04:00 UTC's purge_raw_metric_samples runs, so the two
-- cron jobs slot back-to-back in the same low-traffic window.
--
-- An API route POST /api/cron/period-rollover (Next.js) calls the same
-- function. The route is the platform's recovery path if pg_cron has
-- been disabled or the local dev environment runs without cron.
--
-- H-13: SET search_path = public.

CREATE OR REPLACE FUNCTION rollover_org_periods()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_period_length_days INTEGER;
  v_rolled_over        INTEGER := 0;
BEGIN
  -- Period length from platform_config (V1.x-C.2 seed = 30 days).
  SELECT (value)::TEXT::INTEGER INTO v_period_length_days
  FROM platform_config
  WHERE key = 'plan.period_length_days';

  IF v_period_length_days IS NULL OR v_period_length_days <= 0 THEN
    -- Misconfig — leave usage counters alone. The admin dashboard's
    -- platform_config viewer will surface this; failing closed is the
    -- safer policy (no rollover = users hit cap = obvious symptom).
    RETURN jsonb_build_object(
      'rolled_over', 0,
      'error',       'plan.period_length_days missing or non-positive'
    );
  END IF;

  -- Roll over orgs whose period has ended. The WHERE clause filters
  -- both "period_start is NULL" (defensive — never assigned) and
  -- "period_start + period_length <= NOW()" (period elapsed).
  UPDATE organisations
  SET
    token_usage_credits   = 0,
    current_period_start  = NOW()
  WHERE token_allocation_credits IS NOT NULL  -- only enforced orgs
    AND (
      current_period_start IS NULL
      OR current_period_start + (v_period_length_days || ' days')::INTERVAL <= NOW()
    );
  GET DIAGNOSTICS v_rolled_over = ROW_COUNT;

  RETURN jsonb_build_object(
    'rolled_over',         v_rolled_over,
    'period_length_days',  v_period_length_days
  );
END;
$$;

REVOKE ALL ON FUNCTION rollover_org_periods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rollover_org_periods() TO service_role;

-- Schedule daily at 03:00 UTC.
SELECT cron.schedule(
  'rollover_org_periods',
  '0 3 * * *',
  $$SELECT rollover_org_periods();$$
);
