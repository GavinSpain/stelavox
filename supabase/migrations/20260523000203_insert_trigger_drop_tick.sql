-- M-203 — replace the 1s dispatcher_tick pg_cron with an INSERT trigger.
--
-- Per docs/stelavox_brief_orchestration_v1_0.md §5.3, the new model is
-- event-driven: an INSERT trigger on agent_jobs fires
-- pg_notify('dispatcher_tick_request', ...) whenever a row enters
-- state='queued'. The 30s reconcile sweep handles scheduled-time
-- wakeups + recovery.
--
-- This drops the 1s `dispatcher_tick` pg_cron schedule (replaced by
-- the trigger) and the redundant `scheduler_sweep_throttle_reservations`
-- (folded into reconcile_orchestration_state at M-199).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. INSERT trigger
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agent_jobs_notify_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state = 'queued' THEN
    PERFORM pg_notify('dispatcher_tick_request',
      jsonb_build_object('requested_at', NOW(), 'cause', 'agent_jobs_insert', 'job_id', NEW.id)::TEXT);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_jobs_notify_insert ON public.agent_jobs;
CREATE TRIGGER trg_agent_jobs_notify_insert
  AFTER INSERT ON public.agent_jobs
  FOR EACH ROW
  EXECUTE FUNCTION agent_jobs_notify_insert();

COMMENT ON TRIGGER trg_agent_jobs_notify_insert ON public.agent_jobs IS
  'Apollo: fires pg_notify(dispatcher_tick_request) on every queued agent_job INSERT. Replaces the 1s pg_cron tick.';

COMMIT;

-- ---------------------------------------------------------------------------
-- 2. Drop replaced pg_cron schedules
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('dispatcher_tick')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dispatcher_tick');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.unschedule dispatcher_tick failed (may not exist): %', SQLERRM;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('scheduler_sweep_throttle_reservations')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'scheduler_sweep_throttle_reservations');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron.unschedule scheduler_sweep_throttle_reservations failed (may not exist): %', SQLERRM;
END;
$$;
