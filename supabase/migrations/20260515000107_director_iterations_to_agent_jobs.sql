-- Migration 107 — V1.x-B.2.1: drop director_iterations standalone table;
--                              move iteration state onto agent_jobs.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §3.2.1 M-107
--         + Director Architecture v2.0 §8.1a (per-iteration as agent_jobs).
--
-- The V1.x-B.1.1 director_iterations table (M-093) was a holding-pattern
-- substrate: it modelled iteration state separately from agent_jobs
-- because the executor refactor hadn't landed yet. B.2.1 lands the
-- per-iteration model where each iteration IS an agent_jobs row of
-- operation_type='director_iteration'. The standalone table is removed.
--
-- The build checklist (§11) explicitly authorises this drop: "No
-- destructive operations on shipped tables other than M-107 (drop V1.x-B.1.1
-- director_iterations standalone table — this table was only ever a
-- holding pattern; rows did not contain user data)."
--
-- iteration_state JSONB on agent_jobs carries:
--   - assistant_messages[] — the running messages-array protocol body
--     (per SU-47), including text + tool_use content blocks
--   - pending_tool_results[] — tool_result content blocks awaiting the
--     next iteration's user-message construction
--   - user_message — the original user message that started this turn
--   - system_prompt_version — frozen at turn start
--   - model — frozen at turn start
--   - __schema_version — H-21 mitigation; incremented on shape evolution
--
-- The runner reads __schema_version, applies any in-memory migration if
-- older than current, never persists in mixed shape.

-- ---------------------------------------------------------------------------
-- iteration_state column on agent_jobs
-- ---------------------------------------------------------------------------

ALTER TABLE agent_jobs
  ADD COLUMN iteration_state JSONB NULL;

-- ---------------------------------------------------------------------------
-- Rewrite scheduler_sweep_interrupted_iterations to query agent_jobs.
-- ---------------------------------------------------------------------------
-- The V1.x-B.1.1 implementation (M-099) UPDATEd director_iterations.
-- B.2.1 redirects the same procedure to UPDATE agent_jobs:
--   - Targets queue_status IN ('dispatched','running') with stale heartbeat
--   - Sets queue_status='crashed' (V1.x-B.1.1 used 'interrupted' on
--     director_iterations; the v2 status machine doesn't have 'interrupted'
--     — 'crashed' is the equivalent terminal queue_status, with
--     failure_class='B' marking it Class-B-resumable)
--   - Sets failure_class='B' so the user surface knows the work can be resumed
--   - Sets crashed_at = NOW() (M-105 added this column)
--   - Sets status='failed' to align the business-outcome column
--
-- The procedure signature stays compatible (same return type, same
-- parameter) so M-102's pg_cron schedule continues to call it.

CREATE OR REPLACE FUNCTION scheduler_sweep_interrupted_iterations(
  p_stale_threshold_seconds INTEGER DEFAULT 60
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER;
BEGIN
  UPDATE agent_jobs
  SET queue_status   = 'crashed',
      status         = 'failed',
      failure_class  = 'B',
      crashed_at     = NOW(),
      error_message  = format('heartbeat stale (>%s seconds)', p_stale_threshold_seconds)
  WHERE queue_status IN ('dispatched','running')
    AND last_heartbeat_at IS NOT NULL
    AND last_heartbeat_at < NOW() - (p_stale_threshold_seconds || ' seconds')::INTERVAL;

  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

REVOKE ALL ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scheduler_sweep_interrupted_iterations(INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- Drop director_iterations
-- ---------------------------------------------------------------------------
-- The publication membership comes off automatically on table drop in PG14+.
-- The recovery-sweep procedure was rewritten above to query agent_jobs
-- so the cron job continues to work without any pg_cron schedule change.

DROP TABLE IF EXISTS director_iterations;
