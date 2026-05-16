-- Migration 149: status enum 4 → 2 reduction
--
-- Phase 6.A — Locking and Workflow / status simplification.
--
-- Per Phase 6 deep-dive (2026-05-17), the `nodes.status` enum reduces
-- to {draft, approved}. The `in_review` and `locked` values are
-- vestigial:
--
--   - in_review: declared in M-004 but never had a user story, never
--     wired to a journey, never used in production. Implied a review-
--     workflow feature that V1 doesn't have.
--   - locked: the user-facing locking semantics live entirely on the
--     `nodes.locked` BOOLEAN (Category 1 Author Lock). The enum value
--     was schema-doubling with no purpose. Lock is its own axis post-
--     Phase 6.
--
-- Audit run 2026-05-17 on local DB: 0 in_review rows, 0 status=locked
-- rows. Defensive UPDATEs below cover cloud + future drift; on local
-- the UPDATE rows-affected is 0 for both.
--
-- Status is now purely the author's editorial-progress label. Bidirec-
-- tional free flips (no state machine). Lock and Status are MECE.

UPDATE nodes SET status = 'draft' WHERE status = 'in_review';
UPDATE nodes SET status = 'approved' WHERE status = 'locked';

ALTER TABLE nodes DROP CONSTRAINT nodes_status_check;

ALTER TABLE nodes ADD CONSTRAINT nodes_status_check
  CHECK (status IN ('draft', 'approved'));

COMMENT ON COLUMN nodes.status IS
  'Author-driven editorial label. {draft, approved}. Descriptive, not enforcing. Status changes pass through check_node_writable like any other write (so a locked node cannot have its status changed until unlocked).';
