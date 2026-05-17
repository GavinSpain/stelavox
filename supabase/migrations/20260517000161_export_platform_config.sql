-- Migration 161: platform_config keys for Phase 7 Export
--
-- Phase 7.A — Export Foundation.
--
-- Six configuration keys per wireframe §06 (size limits) + retention.
-- Per H-12 all operational values live in platform_config, tunable
-- without a code change.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  (
    'export.signed_url_ttl_hours',
    '168',
    'How long a download URL remains valid after export completion. Default 168 hours = 7 days. After expiry, the row stays in history but the file is purged from Storage (M-162 retention cron) and the UI shows a Re-run button.',
    'integer'
  ),
  (
    'export.max_words_per_document',
    '1500000',
    'Hard limit on total word count for a single export. Default 1,500,000 words = roughly 5,000 pages. Pre-validation at runner Stage 1 fails over-limit exports with a clear message + EPUB fallback suggestion for DOCX-over-limit cases (per D7).',
    'integer'
  ),
  (
    'export.max_chapters_per_document',
    '500',
    'Hard limit on chapter count. Defensive — most novels are under 100 chapters; 500 is the upper bound for compilation works. Validation at Stage 1.',
    'integer'
  ),
  (
    'export.max_render_minutes',
    '4',
    'Soft estimate threshold for pre-validation. Documents predicted to exceed this trigger the soft warning ("this will take a few minutes"). Validates the render-budget but does not block; user confirms.',
    'integer'
  ),
  (
    'export.max_file_size_mb',
    '50',
    'Hard ceiling on output file size. Defensive — typical novel DOCX is 1-5 MB. Prevents extreme-edge-case files from polluting Storage.',
    'integer'
  ),
  (
    'export.soft_warning_words',
    '900000',
    'Threshold for the soft "this will take a few minutes" warning. Default 900,000 words = roughly 3,000 pages. Below this: no warning; above: user confirms before runner starts.',
    'integer'
  )
ON CONFLICT (key) DO NOTHING;
