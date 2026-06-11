-- Migration M-217: bump pg_net timeout for invoke_scheduler_endpoint
--
-- Phase 9.2 cutover-smoke finding (2026-06-11). The first cloud
-- invocation of invoke_scheduler_endpoint succeeded server-side
-- (Vercel /api/cron/dispatcher-tick returned 200 in 5161ms) but
-- pg_net recorded a client-side timeout: its default
-- timeout_milliseconds is 5000ms, right under the dispatcher's
-- actual runtime even for a single tick on an empty queue.
--
-- Symptoms left untreated:
--   1. net._http_response fills with timeout errors that mask real
--      HTTP failures (auth, 500s, etc.) under noise
--   2. dispatcher_sweep_http (per-minute cron) generates one
--      timeout row per minute
--
-- Fix: pass timeout_milliseconds := 30000 on every http_post. 30s
-- comfortably covers the dispatcher-tick burst path (up to ~60s
-- Vercel maxDuration with intra-tick delay) without ever blocking the
-- trigger transaction — http_post is async; the timeout is just the
-- request-completion deadline for response recording. Routes that
-- return faster still record their actual duration.

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
  -- Gate 1: base URL configured?
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
    RAISE WARNING 'invoke_scheduler_endpoint: vault read failed (%) — skipping %', SQLERRM, p_path;
    RETURN;
  END;
  IF v_secret IS NULL THEN
    RAISE WARNING 'invoke_scheduler_endpoint: no cron_secret in vault — skipping %', p_path;
    RETURN;
  END IF;

  -- Fire-and-forget POST. timeout_milliseconds = 30000 — see header.
  BEGIN
    PERFORM net.http_post(
      url := v_base || p_path,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_secret,
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'invoke_scheduler_endpoint: http_post failed (%) for %', SQLERRM, p_path;
  END;
END;
$$;
