-- Migration 122 — V1.x-B.2.3: pg_cron jobs (dispatcher_tick + batch_poller +
--                              route_capacity_sampler) + SQL stub functions.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-122.
--
-- Schedules three new cron jobs. The job bodies all emit pg_notify on
-- dedicated channels — the TS listener (lib/scheduler/listener.ts) picks
-- up the notifications and invokes the corresponding TS function. This
-- pattern keeps the migration portable across local Docker Supabase
-- (where pg_net may not be installed) and cloud, AND keeps the actual
-- tick / poll / sample logic in TS where unit tests can exercise it.
--
-- Cron cadence:
--   - dispatcher_tick — every 1 second (the LISTEN listener also fires
--     on scheduler_completion notifications; cron is the safety floor)
--   - batch_poller — every 5 minutes (matches platform_config
--     batched_24h_poll_interval_minutes default)
--   - route_capacity_sampler — every 1 minute
--   - reservation_sweep — already from V1.x-B.1.1 (M-102), retained
--   - evaluate_ready_stage_triggers — already from V1.x-B.1.1 (M-102), retained
--
-- Channels:
--   dispatcher_tick_request   — listener invokes lib/scheduler/dispatcher.runDispatcherTick
--   batch_poll_request        — listener invokes lib/scheduler/batch-poller.pollAllInProgressBatches
--   route_sample_request      — listener invokes lib/scheduler/metrics-samplers.recordRouteCapacitySamples

-- ---------------------------------------------------------------------------
-- 1. SQL stub functions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION request_dispatcher_tick()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('dispatcher_tick_request', jsonb_build_object('requested_at', NOW())::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION request_dispatcher_tick() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_dispatcher_tick() TO service_role;

CREATE OR REPLACE FUNCTION request_batch_poll()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('batch_poll_request', jsonb_build_object('requested_at', NOW())::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION request_batch_poll() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_batch_poll() TO service_role;

CREATE OR REPLACE FUNCTION request_route_capacity_sample()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('route_sample_request', jsonb_build_object('requested_at', NOW())::TEXT);
END;
$$;

REVOKE ALL ON FUNCTION request_route_capacity_sample() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_route_capacity_sample() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Schedule the cron jobs
-- ---------------------------------------------------------------------------
-- pg_cron's minimum granularity is 1 second; the dispatcher_tick uses
-- '1 second' as its cadence. The LISTEN-driven invocation path
-- (scheduler_completion notifications fired by the M-109 trigger)
-- still provides sub-tick reactivity to terminal-status transitions.

-- pg_cron schedule formats:
--   '<N> seconds' / '<N> minutes' — pg_cron natural-language for sub-minute
--                                   and minute-granularity (NOT plural-N for >1)
--   '*/N * * * *' — standard cron for minute+ granularity
--   pg_cron rejects ambiguous forms like '5 minutes' (plural minutes >1
--   isn't its natural-language; use cron syntax for those).

SELECT cron.schedule(
  'dispatcher_tick',
  '1 second',
  $$SELECT request_dispatcher_tick();$$
);

SELECT cron.schedule(
  'batch_poller',
  '*/5 * * * *',
  $$SELECT request_batch_poll();$$
);

SELECT cron.schedule(
  'route_capacity_sampler',
  '* * * * *',
  $$SELECT request_route_capacity_sample();$$
);
