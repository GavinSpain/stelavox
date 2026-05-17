-- Migration 159: export_profiles table
--
-- Phase 7.A — Export Foundation.
--
-- Per D6, export profiles are brought forward from Phase 4 to V1. They
-- enable authors to save named configurations per project, plus 4
-- built-in presets shipped at migration time:
--   - DOCX — Manuscript (editor handoff)
--   - DOCX — Kindle / KDP (paperback)
--   - EPUB — Standard e-reader
--   - Outline — Structural overview
--
-- Built-in profiles have organisation_id=NULL, project_id=NULL, and
-- is_builtin=TRUE. They're visible to every project (the runner +
-- profile selector union built-in with project-scoped). They're
-- immutable — update/delete RPCs (M-160) refuse if is_builtin=TRUE.
--
-- Author-saved profiles have a concrete organisation_id + project_id;
-- author created them through the UI and can edit/delete them. They're
-- scoped to a single project; cross-project sharing is V2 polish.

CREATE TABLE export_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for built-in; concrete UUID for author-saved
  organisation_id UUID REFERENCES organisations(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('docx', 'epub', 'json', 'outline')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_builtin BOOLEAN NOT NULL DEFAULT FALSE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Invariant: built-in profiles have NULL org+project; author-saved have both.
  CONSTRAINT export_profiles_builtin_or_scoped CHECK (
    (is_builtin = TRUE AND organisation_id IS NULL AND project_id IS NULL) OR
    (is_builtin = FALSE AND organisation_id IS NOT NULL AND project_id IS NOT NULL)
  )
);

CREATE INDEX idx_export_profiles_project ON export_profiles(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_export_profiles_builtin ON export_profiles(is_builtin) WHERE is_builtin = TRUE;
CREATE INDEX idx_export_profiles_format ON export_profiles(format);

ALTER TABLE export_profiles ENABLE ROW LEVEL SECURITY;

-- Read policy: built-in visible to all authenticated users; author-saved
-- visible only to org members.
CREATE POLICY "export_profiles_read" ON export_profiles
  FOR SELECT USING (
    is_builtin = TRUE
    OR organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Write policy: none for authenticated. Writes go through SECURITY
-- DEFINER RPCs (M-160) which enforce the additional checks.
-- (No INSERT/UPDATE/DELETE policy = denied for non-service-role.)

-- Add the deferred FK from export_jobs.profile_id (M-158) now that
-- export_profiles exists.
ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_profile_id_fkey
  FOREIGN KEY (profile_id) REFERENCES export_profiles(id) ON DELETE SET NULL;

-- ─── Built-in profile seeds ────────────────────────────────────────────
--
-- 4 rows at organisation_id=NULL, project_id=NULL, is_builtin=TRUE.
-- Config shape matches the wireframe §02/§03/§04 settings panels.

INSERT INTO export_profiles (name, format, config, is_builtin) VALUES
  (
    'Manuscript (editor handoff)',
    'docx',
    jsonb_build_object(
      'page_size', 'letter',
      'margins', 'manuscript',
      'font', 'cambria_12',
      'line_spacing', 'double',
      'scene_separator', '* * *',
      'chapter_heading', 'centred_numbered',
      'page_break_per_chapter', true,
      'include_front_matter', true,
      'page_numbers', true,
      'blind_mode', false,
      'include_toc', false
    ),
    TRUE
  ),
  (
    'Kindle / KDP (paperback)',
    'docx',
    jsonb_build_object(
      'page_size', '6x9',
      'margins', 'kdp_paperback',
      'font', 'times_12',
      'line_spacing', 'single',
      'scene_separator', '* * *',
      'chapter_heading', 'centred_numbered',
      'page_break_per_chapter', true,
      'include_front_matter', true,
      'page_numbers', false,
      'blind_mode', false,
      'include_toc', false,
      'first_line_indent_inches', 0.3,
      'paragraph_spacing_pt', 0
    ),
    TRUE
  ),
  (
    'Standard e-reader',
    'epub',
    jsonb_build_object(
      'body_font', 'reader_default',
      'paragraph_indent', 'first_line',
      'scene_separator', '* * *',
      'chapter_heading', 'centred_numbered',
      'include_cover', false
    ),
    TRUE
  ),
  (
    'Structural overview',
    'outline',
    jsonb_build_object(
      'max_depth', NULL,
      'include_word_count_target', false,
      'include_status', false
    ),
    TRUE
  );

COMMENT ON TABLE export_profiles IS
  'Phase 7 D6 — named export configurations. Built-in (org/project NULL, is_builtin TRUE) visible to all; author-saved scoped to a project. Read via RLS for org members; writes via SECURITY DEFINER RPCs (M-160).';
