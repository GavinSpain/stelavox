-- Migration 037 — content_revision default 1 + backfill
-- Source: SU-J14-8 (Phase 5d Tier 4 hardening 2026-05-09).
--
-- Migration 035 added content_revision with DEFAULT 0. New nodes
-- inserted via the API routes (which don't set content_revision
-- explicitly) ended up with content_revision=0 while version=1, breaking
-- the implicit invariant content_revision >= version. The PATCH
-- validation's min(1) on expected_content_revision then rejected
-- autosave concurrency tokens against fresh nodes with 400.
--
-- This migration:
--   1. Changes DEFAULT to 1 so new INSERTs without an explicit value
--      mirror version=1.
--   2. Backfills any existing nodes with content_revision=0 to 1 so
--      the invariant holds across the table.

ALTER TABLE nodes ALTER COLUMN content_revision SET DEFAULT 1;

UPDATE nodes SET content_revision = 1 WHERE content_revision = 0;

COMMENT ON COLUMN nodes.content_revision IS
  'Always-current durability anchor. Bumps on every content-changing UPDATE. '
  'Used for autosave concurrency. Initial value 1 mirrors version=1 so the '
  'invariant content_revision >= version holds at INSERT time. SU-J14-1, J14-8.';
