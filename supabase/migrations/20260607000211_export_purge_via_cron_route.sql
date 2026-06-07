-- Migration 211: Replace pg_cron export retention with a Vercel cron route.
--
-- The Phase 7 design (M-162) used pg_cron to DELETE export_jobs rows past
-- their signed_url_expires_at — but pg_cron only runs SQL, so the
-- corresponding Storage files were left orphaned with no cleanup. This
-- migration unschedules that job, drops the now-dead function, and adds
-- a new platform_config key controlling the failed/cancelled retention
-- window. Storage cleanup + row cleanup now happen together in
-- `POST /api/cron/purge-expired-exports` (Vercel Cron daily at 03:30
-- UTC), which can call the Supabase Storage REST API to delete files.
--
-- The Vercel cron route handles three passes per run:
--   1. Completed exports past signed_url_expires_at — delete file then
--      delete row.
--   2. Failed / cancelled exports older than export.failed_retention_hours
--      — delete file (if any) then delete row.
--   3. Orphan sweep — bucket files > 1h old with no matching row.
--
-- The recovery_sweep_exports pg_cron job (also from M-162) is unchanged
-- and remains scheduled — it only flips stuck rows to status='failed',
-- which is pure SQL and rightly stays in pg_cron.

-- ─── Unschedule the daily purge job ────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'export_purge_expired') THEN
    PERFORM cron.unschedule('export_purge_expired');
  END IF;
END $$;

-- ─── Drop the SQL function (its only caller is now gone) ───────────────

DROP FUNCTION IF EXISTS purge_expired_exports();

-- ─── Add failed/cancelled retention config ─────────────────────────────

INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'export.failed_retention_hours',
    '24',
    'How long failed and cancelled export_jobs rows are kept before deletion. Default 24 hours = 1 day. After this, the cron route deletes the file (if any) and the row. Set lower for tighter cleanup; set higher to keep error history longer for debugging.',
    'integer'
  )
ON CONFLICT (key) DO NOTHING;
