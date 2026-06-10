-- Migration M-216: pg_net cloud dispatch transport (Phase 9.2 / DR-063 Option E)
--
-- Decision locked 2026-06-10: "the database is the scheduler's clock;
-- Vercel is stateless compute." The V1.x-B.2 architecture drives the WFQ
-- dispatcher via pg_notify + a long-lived TS LISTEN connection
-- (lib/scheduler/listener.ts) — which cannot exist on Vercel (no
-- persistent process; NOTIFY evaporates if nobody is listening at that
-- instant). Instead of renting an always-on worker to hold the LISTEN
-- (Option A), the database now actively CALLS OUT over HTTPS via pg_net:
--
--   1. invoke_scheduler_endpoint(path) — SECURITY DEFINER helper. Reads
--      `scheduler.cloud_dispatch_base_url` from platform_config; when the
--      key is absent / JSON null / empty (== local dev), it is a NO-OP —
--      local keeps the listener at millisecond latency, cloud gets HTTP.
--      Reads the bearer secret from Vault (name 'cron_secret'); POSTs
--      via net.http_post (async, fire-and-forget). Every failure path is
--      swallowed with a WARNING — a transport hiccup must never abort
--      the calling trigger's transaction.
--
--   2. Completion push — agent_jobs_notify_completion() (M-109/M-205
--      shape preserved) additionally invokes /api/cron/dispatcher-tick.
--      Iteration N completing dispatches N+1 at HTTP latency (~100-300ms),
--      preserving the Director loop's chaining behaviour in cloud.
--
--   3. Enqueue push — new AFTER INSERT trigger on agent_jobs (queued +
--      consumer_kind='dispatcher') invokes the same endpoint, so the
--      FIRST job of a fresh queue dispatches immediately (workflow
--      approve, push-model evaluator inserts) instead of waiting for the
--      sweep.
--
--   4. Cadence baselines — request_batch_poll() +
--      request_route_capacity_sample() gain the gated HTTP invoke (their
--      pg_cron cadences are 5min / 1min — fine over HTTP). The 1-SECOND
--      dispatcher_tick job deliberately stays pg_notify-only (an HTTP
--      POST per second 24/7 is waste); a NEW 1-minute pg_cron job
--      'dispatcher_sweep_http' is the cloud sweep for stragglers, aging
--      promotion, and crash recovery.
--
--   5. DR-117 — request_synthetic_probe() gains the gated HTTP invoke to
--      /api/cron/run-probes?probe_id=… so the M-148 daily probe schedule
--      works in cloud without Vercel-Cron slots (Hobby cap: 2 jobs).
--
-- Double-fire safety: the dispatcher's CAS-on-claim + reservation
-- lifecycle make concurrent/duplicate ticks harmless (established
-- V1.x-B.2 invariant; restated in app/api/cron/dispatcher-tick).
--
-- Cloud activation runbook (NOT in this migration — per-environment):
--   a. INSERT/UPDATE platform_config 'scheduler.cloud_dispatch_base_url'
--      = '"https://<app-host>"'
--   b. SELECT vault.create_secret('<CRON_SECRET value>', 'cron_secret')
--   c. Verify pg_net enabled (it is, below) + watch net._http_response.

-- ---------------------------------------------------------------------------
-- 0. pg_net extension
-- ---------------------------------------------------------------------------
-- Available in Supabase cloud and recent local CLI images. Guarded so an
-- exotic local image without it doesn't fail the migration — the helper
-- degrades to WARNING + no-op if net.http_post is absent.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'M-216: pg_net extension unavailable (%) — cloud dispatch helper will no-op', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Config key (documented; JSON null = disabled = local default)
-- ---------------------------------------------------------------------------
INSERT INTO platform_config (key, value, value_type, description)
VALUES (
  'scheduler.cloud_dispatch_base_url',
  'null'::jsonb,
  'string',
  'Base URL (e.g. "https://stelavox.vercel.app") that DB-side scheduler events POST to via pg_net. JSON null disables the HTTP transport (local dev uses the LISTEN listener instead). M-216 / DR-063 Option E.'
)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The invoke helper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION invoke_scheduler_endpoint(p_path TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_secret TEXT;
BEGIN
  -- Gate 1: base URL configured? (JSON null / absent / empty = local = no-op)
  SELECT NULLIF(TRIM(BOTH '"' FROM value::TEXT), 'null')
    INTO v_base
    FROM platform_config
   WHERE key = 'scheduler.cloud_dispatch_base_url';
  IF v_base IS NULL OR v_base = '' THEN
    RETURN;
  END IF;

  -- Gate 2: bearer secret present in Vault?
  BEGIN
    SELECT decrypted_secret INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'cron_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'invoke_scheduler_endpoint: vault read failed (%) — skipping % ', SQLERRM, p_path;
    RETURN;
  END;
  IF v_secret IS NULL THEN
    RAISE WARNING 'invoke_scheduler_endpoint: no cron_secret in vault — skipping %', p_path;
    RETURN;
  END IF;

  -- Fire-and-forget POST. net.http_post queues the request on pg_net's
  -- background worker and returns immediately; response handling is
  -- observability-only (net._http_response).
  BEGIN
    PERFORM net.http_post(
      url := v_base || p_path,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'invoke_scheduler_endpoint: http_post failed (%) for %', SQLERRM, p_path;
  END;
END;
$$;

REVOKE ALL ON FUNCTION invoke_scheduler_endpoint(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invoke_scheduler_endpoint(TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Completion push — extend agent_jobs_notify_completion
-- ---------------------------------------------------------------------------
-- Body reproduced from M-109 (+ M-205's consumer_kind awareness is in the
-- INSERT-notify trigger, not this one) with ONE addition at the end: the
-- gated HTTP invoke. pg_notify stays for the local listener path.
CREATE OR REPLACE FUNCTION agent_jobs_notify_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payload JSONB;
BEGIN
  v_payload := jsonb_build_object(
    'agent_job_id',     NEW.id,
    'queue_status',     NEW.queue_status,
    'operation_type',   NEW.operation_type,
    'organisation_id',  NEW.organisation_id,
    'document_id',      NEW.document_id,
    'director_turn_id', NEW.director_turn_id,
    'iteration_number', NEW.iteration_number,
    'failure_class',    NEW.failure_class,
    'completed_at',     EXTRACT(EPOCH FROM NEW.completed_at)
  );
  PERFORM pg_notify('scheduler_completion', v_payload::TEXT);
  -- M-216: cloud transport — chain the next dispatch over HTTPS.
  PERFORM invoke_scheduler_endpoint('/api/cron/dispatcher-tick');
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Enqueue push — new trigger for instant first-dispatch in cloud
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION agent_jobs_enqueue_dispatch_push()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM invoke_scheduler_endpoint('/api/cron/dispatcher-tick');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_jobs_enqueue_dispatch_push ON agent_jobs;
CREATE TRIGGER trg_agent_jobs_enqueue_dispatch_push
  AFTER INSERT ON agent_jobs
  FOR EACH ROW
  WHEN (NEW.queue_status = 'queued' AND NEW.consumer_kind = 'dispatcher')
  EXECUTE FUNCTION agent_jobs_enqueue_dispatch_push();

-- ---------------------------------------------------------------------------
-- 5. Cadence functions gain the gated HTTP invoke
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION request_batch_poll()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('batch_poll_request', jsonb_build_object('requested_at', NOW())::TEXT);
  PERFORM invoke_scheduler_endpoint('/api/cron/poll-batches');
END;
$$;

CREATE OR REPLACE FUNCTION request_route_capacity_sample()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('route_sample_request', jsonb_build_object('requested_at', NOW())::TEXT);
  PERFORM invoke_scheduler_endpoint('/api/cron/route-sample');
END;
$$;

-- request_dispatcher_tick() deliberately UNCHANGED (pg_notify only): its
-- pg_cron job runs every second — fine as an in-DB shout for the local
-- listener; unacceptable as an HTTP-per-second firehose. The cloud sweep
-- is the dedicated 1-minute job below.

-- DR-117 — probes ride the same transport.
CREATE OR REPLACE FUNCTION request_synthetic_probe(p_probe_id TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM pg_notify('synthetic_probe_request', jsonb_build_object(
    'probe_id', p_probe_id,
    'requested_at', NOW()
  )::TEXT);
  PERFORM invoke_scheduler_endpoint('/api/cron/run-probes?probe_id=' || p_probe_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Cloud sweep — 1-minute HTTP baseline
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.schedule(
    'dispatcher_sweep_http',
    '* * * * *',
    $job$SELECT invoke_scheduler_endpoint('/api/cron/dispatcher-tick');$job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'M-216: could not schedule dispatcher_sweep_http (%) — pg_cron unavailable?', SQLERRM;
END $$;
