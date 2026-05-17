-- Migration 158: export_jobs extensions for Phase 7
--
-- Phase 7.A — Export Foundation.
--
-- Extends the Phase 1 export_jobs table (Migration 007) with:
--   - progress JSONB (structured progress per Phase 7 §05 wireframe)
--   - profile_id UUID FK (which export_profile drove this export)
--   - last_active_at (heartbeat for recovery sweep)
--   - cancellation_requested_at (per Stop pattern from V1.x-B.2)
--   - attempt_count (for retry tracking)
--   - total_chapters (computed at plan stage; surfaced in progress UI)
--
-- The status enum expands beyond M-007's {pending, running, completed,
-- failed} to cover the 7-state pipeline per wireframe §05:
--   - queued: row created, runner not yet started
--   - planning: runner started, validating + counting chapters
--   - rendering: per-chapter rendering in progress
--   - assembling: format-library final document build
--   - uploading: pushing to Supabase Storage
--   - completed: signed URL available; terminal success
--   - failed: terminal error; error_message populated
--   - cancellation_requested: user requested cancel; runner will halt at next boundary
--   - cancelled: terminal user-stop
--
-- D2 (Option B): the runner is re-entrant. If a function call is killed
-- mid-export, last_active_at goes stale, the recovery_sweep cron
-- (M-162) marks the row as failed with runner_timeout, and the author
-- can retry. Persistence of progress.current_chapter in JSONB allows
-- a future resumption-on-retry — V1 retries from scratch; resumption-
-- on-retry is a V1.x polish.

ALTER TABLE export_jobs
  ADD COLUMN progress JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE export_jobs
  ADD COLUMN profile_id UUID;  -- FK added in M-159 once export_profiles exists

ALTER TABLE export_jobs
  ADD COLUMN last_active_at TIMESTAMPTZ;

ALTER TABLE export_jobs
  ADD COLUMN cancellation_requested_at TIMESTAMPTZ;

ALTER TABLE export_jobs
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 1;

ALTER TABLE export_jobs
  ADD COLUMN total_chapters INTEGER;

-- Expand the status CHECK constraint to cover the 7-state pipeline.
ALTER TABLE export_jobs DROP CONSTRAINT IF EXISTS export_jobs_status_check;
ALTER TABLE export_jobs ADD CONSTRAINT export_jobs_status_check
  CHECK (status IN (
    'queued',
    'pending',  -- legacy compatibility (M-007 default); treated as 'queued'
    'planning',
    'running',  -- legacy compatibility; treated as 'rendering'
    'rendering',
    'assembling',
    'uploading',
    'completed',
    'failed',
    'cancellation_requested',
    'cancelled'
  ));

-- Backfill: any pre-Phase-7 row at 'pending' → 'queued'; 'running' → 'rendering'.
UPDATE export_jobs SET status = 'queued' WHERE status = 'pending';
UPDATE export_jobs SET status = 'rendering' WHERE status = 'running';

-- Primary index for the recovery sweep — find active rows whose
-- heartbeat is stale. Same shape as V1.x-B.2 M-106's recovery index.
CREATE INDEX IF NOT EXISTS idx_export_jobs_active_runner
  ON export_jobs(status, last_active_at)
  WHERE status IN ('queued', 'planning', 'rendering', 'assembling', 'uploading');

-- Index for the per-document history panel.
CREATE INDEX IF NOT EXISTS idx_export_jobs_document_created
  ON export_jobs(document_id, created_at DESC);

-- Realtime publication so the UI's useExportProgress hook can subscribe.
-- The publication name is the Supabase default; idempotent ALTER.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'export_jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE export_jobs;
  END IF;
END $$;

COMMENT ON COLUMN export_jobs.progress IS
  'Phase 7 D3 — structured progress per wireframe §05. Shape: { phase: "queued"|"planning"|"rendering"|"assembling"|"uploading"|"completed"|"failed"|"cancelled", current_chapter?: int, total_chapters?: int, chapter_name?: string, estimated_seconds_remaining?: int, error?: string }. Updated by runner.ts at each pipeline boundary; subscribed by UI via Realtime.';

COMMENT ON COLUMN export_jobs.profile_id IS
  'Phase 7 D6 — links export to the export_profiles row that drove it. Nullable so historical rows survive profile deletion.';

COMMENT ON COLUMN export_jobs.last_active_at IS
  'Phase 7 D2 — heartbeat for recovery sweep. Runner updates this at every pipeline boundary; sweep cron (M-162) marks export failed if stale > 5 min.';

COMMENT ON COLUMN export_jobs.cancellation_requested_at IS
  'Phase 7 — Stop pattern. UI sets this via /api/exports/[id]/cancel; runner checks between pipeline stages and halts at next safe boundary.';

COMMENT ON COLUMN export_jobs.total_chapters IS
  'Phase 7 — computed at plan stage. Surfaces in progress.total_chapters for UI; null until planning completes.';
