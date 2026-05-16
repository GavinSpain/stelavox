-- V1.x-F.3 — pg_cron schedule for daily synthetic-probe runs.
--
-- Source: stelavox_v1x_f_build_checklist_v1_1.md §2 M-148.
--
-- Three jobs at staggered times to spread load + reduce overlap. The
-- probe runner work itself lives in TS (LLM calls + agent_jobs
-- inline-run), so the SQL bodies emit pg_notify on a dedicated channel;
-- the TS listener (lib/scheduler/listener.ts) picks up the notification
-- and POSTs to /api/admin/probe/[probe_id]/run with triggered_by='cron'.
--
-- Pattern matches M-122 (dispatcher_tick + batch_poller +
-- route_capacity_sampler from V1.x-B.2.3).
--
-- Channel:
--   synthetic_probe_request  — payload { probe_id: <probe_id> }
--
-- Cadence:
--   director_small   — daily 04:15 UTC
--   workflow_expand  — daily 04:30 UTC
--   refine_accept    — daily 04:45 UTC
--
-- Retention decision (D-F3-1, locked at F.3 implementation 2026-05-19):
-- keep anthropic_rate_limit_samples retention at the M-145 default of 7
-- days. Bumping to 30 days requires a real signal that 7-day trend
-- isn't enough for regression-spotting; defer until V1.x post-launch
-- polish if the V1.x-E admin dashboard surfaces a need.

CREATE OR REPLACE FUNCTION request_synthetic_probe(p_probe_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_probe_id NOT IN ('director_small', 'workflow_expand', 'refine_accept') THEN
    RAISE EXCEPTION 'invalid_probe_id: %', p_probe_id;
  END IF;
  PERFORM pg_notify(
    'synthetic_probe_request',
    jsonb_build_object('probe_id', p_probe_id, 'requested_at', NOW())::TEXT
  );
END;
$$;

REVOKE ALL ON FUNCTION request_synthetic_probe(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION request_synthetic_probe(TEXT) TO service_role;

-- Three staggered daily schedules. pg_cron times are UTC.
SELECT cron.schedule(
  'synthetic_probe_director_small',
  '15 4 * * *',
  $$SELECT request_synthetic_probe('director_small');$$
);

SELECT cron.schedule(
  'synthetic_probe_workflow_expand',
  '30 4 * * *',
  $$SELECT request_synthetic_probe('workflow_expand');$$
);

SELECT cron.schedule(
  'synthetic_probe_refine_accept',
  '45 4 * * *',
  $$SELECT request_synthetic_probe('refine_accept');$$
);

COMMENT ON FUNCTION request_synthetic_probe(TEXT) IS
  'V1.x-F.3 — pg_cron-callable probe trigger. Emits pg_notify on synthetic_probe_request channel; the TS listener picks up + POSTs /api/admin/probe/[id]/run with triggered_by=cron.';
