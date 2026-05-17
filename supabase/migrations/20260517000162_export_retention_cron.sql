-- Migration 162: pg_cron jobs for export retention + recovery sweep
--
-- Phase 7.A — Export Foundation.
--
-- Two cron jobs:
--   1. purge_expired_exports — daily 03:30 UTC; removes export_jobs
--      rows whose signed_url_expires_at is in the past. The Storage
--      file deletion is the responsibility of the runner / a separate
--      worker since pg_cron can't make HTTPS calls to Storage; for V1
--      we just orphan the file (paid out of attic-cost) and let a
--      Storage lifecycle policy handle the deletion. V1.x polish:
--      explicit Storage cleanup via a Vercel cron route.
--   2. recovery_sweep_exports — every 60 seconds; marks export_jobs
--      rows as failed if their last_active_at is stale. Catches the
--      case where a Vercel function dies mid-export.
--
-- Both functions include SET search_path = public per H-13.

-- ─── purge_expired_exports ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION purge_expired_exports()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM export_jobs
   WHERE status = 'completed'
     AND signed_url_expires_at < NOW()
     AND signed_url_expires_at IS NOT NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ─── recovery_sweep_exports ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION recovery_sweep_exports()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swept INTEGER;
BEGIN
  -- Active states: 'queued' / 'planning' / 'rendering' / 'assembling' / 'uploading'.
  -- If last_active_at is stale > 5 min, the runner is presumed dead.
  -- 'queued' rows older than 1 min with no last_active_at are also
  -- abandoned (the waitUntil call never started).
  UPDATE export_jobs SET
    status = 'failed',
    error_message = CASE
      WHEN last_active_at IS NULL THEN 'runner_never_started'
      ELSE 'runner_timeout'
    END,
    completed_at = NOW()
  WHERE status IN ('queued', 'planning', 'rendering', 'assembling', 'uploading')
    AND (
      (last_active_at IS NOT NULL AND last_active_at < NOW() - INTERVAL '5 minutes')
      OR (last_active_at IS NULL AND created_at < NOW() - INTERVAL '1 minute')
    );
  GET DIAGNOSTICS v_swept = ROW_COUNT;
  RETURN v_swept;
END;
$$;

-- ─── pg_cron scheduling ────────────────────────────────────────────────
--
-- Use the cron schema (Supabase enables pg_cron via the cron extension
-- per V1.x-B.1.1 M-102). Idempotent unschedule + reschedule.

DO $$
BEGIN
  -- daily retention
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'export_purge_expired') THEN
    PERFORM cron.unschedule('export_purge_expired');
  END IF;
  PERFORM cron.schedule(
    'export_purge_expired',
    '30 3 * * *',  -- daily 03:30 UTC
    $cron$SELECT purge_expired_exports();$cron$
  );

  -- 60-second recovery sweep
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'export_recovery_sweep') THEN
    PERFORM cron.unschedule('export_recovery_sweep');
  END IF;
  PERFORM cron.schedule(
    'export_recovery_sweep',
    '* * * * *',  -- every minute
    $cron$SELECT recovery_sweep_exports();$cron$
  );
END $$;

COMMENT ON FUNCTION purge_expired_exports() IS
  'Phase 7 — daily 03:30 UTC. DELETEs export_jobs rows past signed_url_expires_at. Storage files are orphaned (V1) — explicit Storage cleanup is a V1.x polish task.';

COMMENT ON FUNCTION recovery_sweep_exports() IS
  'Phase 7 D2 — every 60 seconds. Marks export_jobs failed if runner is dead (last_active_at stale > 5 min). Catches Vercel function killed mid-export.';
