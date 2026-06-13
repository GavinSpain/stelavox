-- Migration M-225: DR-042 — export per-book + Markdown manuscript + JSON cut
--
-- Locked 2026-06-13 (register v3.4), build 2026-06-14. See
-- docs/stelavox_dr042_export_lineup_design_v1_0.md + wireframe.
--
-- 1. export_jobs.root_node_id — when set (a Book node), the export walks
--    only that book's subtree → one file per book for a Series document.
--    NULL = whole document (today's behaviour, back-compatible).
-- 2. export_jobs.file_name — the user-facing download filename, set at
--    job creation ({Series} — {NN} {Book}.{ext} for per-book; doc name
--    otherwise). Drives the signed-URL Content-Disposition.
-- 3. Markdown manuscript profile — the always-available, whole-document
--    own-your-data backstop (structure + final prose, no history).
-- 4. JSON built-in profile removed (export cut; re-homed to DR-036 as a
--    future export+import feature). export_jobs.format CHECK already
--    permits 'markdown'; historical 'json' rows remain readable.

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS root_node_id UUID REFERENCES nodes(id) ON DELETE SET NULL;

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS file_name TEXT;

COMMENT ON COLUMN export_jobs.root_node_id IS
  'DR-042: subtree root for a per-book export (a Book node). NULL = whole document.';
COMMENT ON COLUMN export_jobs.file_name IS
  'DR-042: user-facing download filename, set at job creation.';

-- export_profiles format CHECK must admit 'markdown' for the built-in
-- manuscript profile.
ALTER TABLE export_profiles DROP CONSTRAINT IF EXISTS export_profiles_format_check;
ALTER TABLE export_profiles
  ADD CONSTRAINT export_profiles_format_check
  CHECK (format IN ('docx', 'epub', 'markdown', 'outline'));

-- Markdown manuscript built-in profile (always-available backstop).
INSERT INTO export_profiles (name, format, config, is_builtin) VALUES
  (
    'Manuscript (Markdown)',
    'markdown',
    jsonb_build_object(
      'scene_separator', '* * *',
      'heading_depth_cap', 6,
      'include_scene_headings', true
    ),
    TRUE
  );

-- JSON export is cut from V1. Remove the built-in JSON profile(s); any
-- historical export_jobs.profile_id pointing at them becomes NULL via the
-- M-159 ON DELETE SET NULL FK. Files already produced remain downloadable.
DELETE FROM export_profiles WHERE is_builtin = TRUE AND format = 'json';
