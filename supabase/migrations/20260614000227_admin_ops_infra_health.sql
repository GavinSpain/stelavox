-- Migration M-227: DR-121 — admin_ops_infra_health() for the Operations
-- Summary liveness band. Reads infra schemas (cron, net, pg_catalog) that
-- PostgREST can't reach, and returns a compact JSONB the /api/admin/ops
-- endpoint surfaces. SECURITY DEFINER + SET search_path per H-13.
--
--   dispatcher_last_tick       — MAX(dispatcher_tick_samples.tick_started_at)
--   cloud_transport_last_ok    — latest net._http_response with status 200
--   cloud_transport_last_any   — latest net._http_response (any status)
--   cron_jobs                  — [{jobname, last_run, status}] per scheduled job
--   realtime_publication_count — tables in the supabase_realtime publication

CREATE OR REPLACE FUNCTION admin_ops_infra_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dispatcher TIMESTAMPTZ;
  v_cloud_ok TIMESTAMPTZ;
  v_cloud_any TIMESTAMPTZ;
  v_cron JSONB := '[]'::jsonb;
  v_realtime INT := 0;
BEGIN
  SELECT MAX(tick_started_at) INTO v_dispatcher FROM dispatcher_tick_samples;

  -- pg_net response log (cloud dispatch transport). Wrapped — the table
  -- may be absent if pg_net isn't installed (local-only edge case).
  BEGIN
    EXECUTE $q$ SELECT MAX(created) FROM net._http_response WHERE status_code = 200 $q$ INTO v_cloud_ok;
    EXECUTE $q$ SELECT MAX(created) FROM net._http_response $q$ INTO v_cloud_any;
  EXCEPTION WHEN OTHERS THEN
    v_cloud_ok := NULL; v_cloud_any := NULL;
  END;

  -- pg_cron job health — last run + status per scheduled job.
  BEGIN
    EXECUTE $q$
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'jobname', j.jobname,
               'last_run', r.last_start,
               'status', r.last_status
             ) ORDER BY j.jobname), '[]'::jsonb)
      FROM cron.job j
      LEFT JOIN LATERAL (
        SELECT start_time AS last_start, status AS last_status
        FROM cron.job_run_details d
        WHERE d.jobid = j.jobid
        ORDER BY d.start_time DESC
        LIMIT 1
      ) r ON TRUE
    $q$ INTO v_cron;
  EXCEPTION WHEN OTHERS THEN
    v_cron := '[]'::jsonb;
  END;

  -- Realtime publication completeness (the M-214 config that broke before).
  BEGIN
    SELECT COUNT(*) INTO v_realtime
    FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
  EXCEPTION WHEN OTHERS THEN
    v_realtime := 0;
  END;

  RETURN jsonb_build_object(
    'dispatcher_last_tick', v_dispatcher,
    'cloud_transport_last_ok', v_cloud_ok,
    'cloud_transport_last_any', v_cloud_any,
    'cron_jobs', v_cron,
    'realtime_publication_count', v_realtime
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_ops_infra_health() FROM PUBLIC, anon, authenticated;
-- service-role only (admin endpoint calls it via the service client).
