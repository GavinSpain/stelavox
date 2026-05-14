-- Migration 099 — V1.x-B.1.1: scheduler maintenance + recovery sweep procedures.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.9
--         + Director Architecture v2.0 §9.9 (reservation TTL — H-17)
--         + V2 §10.2 (interrupted iterations — Class B).
--
-- B.1.1 lands the SQL-side maintenance procedures only. The actual
-- dispatch loop (calling Anthropic, dispatching ready agent_jobs) lives
-- in lib/scheduler/ TypeScript and is invoked by an external cron
-- (Vercel cron or Supabase Edge Function on a schedule) in session 2.
--
-- Two SQL procedures, both pure-SQL maintenance:
--   1. scheduler_sweep_throttle_reservations — H-17 mitigation.
--      Releases expired reservations that were never consumed.
--   2. scheduler_sweep_interrupted_iterations — heartbeat-based
--      interrupted detection. Marks director_iterations as 'interrupted'
--      when last_heartbeat_at is older than the configured threshold.
--      The TypeScript dispatcher then re-enqueues these (session 2).
--
-- The procedures are SECURITY DEFINER and service-role only — invoked
-- by pg_cron (if available) and by lib/scheduler/ tick routine.

-- ---------------------------------------------------------------------------
-- 1. scheduler_sweep_throttle_reservations — release expired reservations.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION scheduler_sweep_throttle_reservations()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER;
BEGIN
  UPDATE throttle_reservations
  SET released_at = NOW()
  WHERE expires_at < NOW()
    AND consumed_at IS NULL
    AND released_at IS NULL;

  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_throttle_reservations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_throttle_reservations() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. scheduler_sweep_interrupted_iterations — heartbeat-based detection.
-- ---------------------------------------------------------------------------
-- Reads scheduler.recovery_sweep_interval_ms from platform_config to
-- compute the stale threshold. Default 30 seconds if config absent.

CREATE OR REPLACE FUNCTION scheduler_sweep_interrupted_iterations(
  p_stale_threshold_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER;
BEGIN
  UPDATE director_iterations
  SET status = 'interrupted',
      failure_class = 'B',
      failure_message = format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
  WHERE status = 'running'
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < NOW() - (p_stale_threshold_seconds || ' seconds')::INTERVAL;

  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- pg_cron scheduling (deferred to session 2).
-- ---------------------------------------------------------------------------
-- The cron install (CREATE EXTENSION pg_cron + cron.schedule(...)) lands
-- alongside lib/scheduler/ tick routine in session 2. The TypeScript
-- dispatcher will call these procedures directly on its tick interval;
-- pg_cron is the safety-net second invocation surface.
--
-- Session 2 will add:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule(
--     'scheduler_sweep_throttle_reservations',
--     '*/30 * * * * *',
--     $$SELECT scheduler_sweep_throttle_reservations();$$
--   );
--   SELECT cron.schedule(
--     'scheduler_sweep_interrupted_iterations',
--     '*/30 * * * * *',
--     $$SELECT scheduler_sweep_interrupted_iterations(60);$$
--   );
