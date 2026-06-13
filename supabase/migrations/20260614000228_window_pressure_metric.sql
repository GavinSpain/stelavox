-- Migration M-228: DR-121 — conversation-window pressure capture.
--
-- The approved proxy for "is the rolling window the right size" (NOT a
-- quality hit-rate — that's the launch test). Per Director turn the
-- context builder calls this fire-and-forget; it increments the current
-- minute's counters in the generic metrics_minute_buckets table:
--   total           — turns observed
--   summary_active  — turns running with a non-null conversation summary
--   eviction        — turns where the rolling-window slice dropped messages
-- Rates derive as summary_active/total and eviction/total.
--
-- SECURITY DEFINER + search_path per H-13. Best-effort: never raises into
-- the Director hot path (the caller ignores errors regardless).

CREATE OR REPLACE FUNCTION bump_conversation_window_pressure(
  p_summary_active BOOLEAN,
  p_evicted BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bucket TIMESTAMPTZ := date_trunc('minute', NOW());
BEGIN
  INSERT INTO metrics_minute_buckets (bucket_started_at, metric_kind, dimensions, value, sample_count)
  VALUES
    (v_bucket, 'conversation_window_pressure', jsonb_build_object('k', 'total'), 1, 1),
    (v_bucket, 'conversation_window_pressure', jsonb_build_object('k', 'summary_active'), CASE WHEN p_summary_active THEN 1 ELSE 0 END, 1),
    (v_bucket, 'conversation_window_pressure', jsonb_build_object('k', 'eviction'), CASE WHEN p_evicted THEN 1 ELSE 0 END, 1)
  ON CONFLICT (bucket_started_at, metric_kind, dimensions)
  DO UPDATE SET value = metrics_minute_buckets.value + EXCLUDED.value,
                sample_count = metrics_minute_buckets.sample_count + EXCLUDED.sample_count;
END;
$$;

REVOKE ALL ON FUNCTION bump_conversation_window_pressure(BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
