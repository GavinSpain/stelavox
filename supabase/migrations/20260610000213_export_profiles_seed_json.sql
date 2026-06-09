-- Migration M-213: built-in JSON export profile
--
-- Phase 7 follow-up (2026-06-10).
--
-- M-159 seeded built-in profiles for DOCX (Manuscript + KDP), EPUB
-- (Standard), and Outline (Structural), but skipped JSON. The
-- consequence:
--
--   - ExportModal renders the JSON format tile (selectable).
--   - The profile dropdown filters by format → empty list for JSON.
--   - effectiveProfileId is null.
--   - The Export button is disabled (`disabled={busy || !effectiveProfileId}`).
--   - JSON can be selected but never exported via the modal.
--
-- The JSON renderer in lib/export/json.ts takes no per-profile config
-- — it emits a fixed-shape backup (document + nodes + node_versions +
-- context + comments + locks + layer_stack). So the built-in profile
-- has an empty config — its only job is to populate the dropdown so
-- the Export button enables.
--
-- Idempotent via `WHERE NOT EXISTS` so re-running the migration is
-- safe (export_profiles has no unique constraint on name + format
-- that we could ON CONFLICT against).

INSERT INTO export_profiles (name, format, config, is_builtin)
SELECT 'Full backup (JSON v1.0)', 'json', '{}'::jsonb, TRUE
WHERE NOT EXISTS (
  SELECT 1 FROM export_profiles
   WHERE format = 'json'
     AND is_builtin = TRUE
);
