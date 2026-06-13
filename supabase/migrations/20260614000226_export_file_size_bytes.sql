-- Migration M-226: DR-121 — export_jobs.file_size_bytes (Band 5 storage).
--
-- The runner already computes the uploaded byte length; persist it in a
-- dedicated column so the admin Operations Summary can SUM storage used
-- across non-expired exports without parsing the progress JSONB. Nullable;
-- historical rows show "—" (no backfill needed).
--
-- The other DR-121 capture items resolve without schema change:
--   - queue-age  → live derive from agent_jobs (oldest queued per class)
--   - realtime health → derive from pg_publication_tables (config health,
--                       the M-214 drift that actually bit us)
--   - window-pressure → metric_kind 'conversation_window_pressure' written
--                       to the existing generic metrics_minute_buckets table
--                       (no schema change)
-- Everything else in the Operations Summary is a SELECT over existing data.

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT;

COMMENT ON COLUMN export_jobs.file_size_bytes IS
  'DR-121: uploaded output size in bytes, for admin storage-used aggregation.';
