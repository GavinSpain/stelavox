-- Migration 156: platform_config keys for Author Lock UX
--
-- Phase 6.B — Author Lock (Category 1).
--
-- One config key seeds the four launch suggestions surfaced in the
-- LockReasonModal (Phase 6 wireframe §03 callout 8). Per H-12 these
-- live in platform_config so they can evolve without a code change.

INSERT INTO platform_config (key, value, description, value_type)
VALUES (
  'locking.reason_suggestions',
  '["Approved final draft", "Saving for revision", "Do not modify", "Reviewer copy"]',
  'Lock reason suggestions surfaced in the LockReasonModal. JSON array of short strings; clients use as quick-fill chips on the optional reason input.',
  'object'
)
ON CONFLICT (key) DO NOTHING;
