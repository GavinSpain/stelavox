-- Migration 091 — V1.x-B.1.1: briefs schema for sequential multi-Brief.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.1
--         + v1x_b_design_session_record_2026-05-14.md §10.
--
-- V1.x-A.1 enforced "one active or planned Brief at a time" via partial
-- unique index on status IN ('planned','active'). V1.x-B.1.1 separates
-- the two: at most ONE 'active' per document; multiple 'planned' or
-- 'queued' Briefs allowed (queue ordering via sequence_position).
--
-- New status: 'queued' — Brief is approved (planned) and waiting for
-- predecessor active Brief to complete.
--
-- New columns:
--   sequence_position — per-document integer for queue ordering.
--   cause — tracks activation cause for audit + future template work.

-- Drop the V1.x-A.1 partial unique index.
DROP INDEX IF EXISTS briefs_one_active_per_document_uidx;

-- Add the stricter index — only one ACTIVE Brief per document. Queued
-- and planned Briefs are unrestricted in count.
CREATE UNIQUE INDEX briefs_strict_one_active_per_document_uidx
  ON briefs(document_id)
  WHERE status = 'active';

-- Add sequence_position column. Default 0; promotion + insertion paths
-- compute the actual value from MAX(sequence_position) + 1.
ALTER TABLE briefs
  ADD COLUMN sequence_position INTEGER NOT NULL DEFAULT 0;

-- Add cause column. Free-form TEXT with CHECK on the V1.x-B.1.1 set.
-- Future phases extend the enum (recurring_schedule, template_instance, etc.).
ALTER TABLE briefs
  ADD COLUMN cause TEXT NOT NULL DEFAULT 'user_initial'
    CHECK (cause IN ('user_initial','sequence_promotion'));

-- Index for queue ordering lookups.
CREATE INDEX idx_briefs_queue_position
  ON briefs(document_id, sequence_position)
  WHERE status IN ('planned','queued');

-- Update status CHECK constraint to admit 'queued'. CHECK constraints
-- in PostgreSQL must be dropped + re-added (no IN-place enum extension).
ALTER TABLE briefs DROP CONSTRAINT briefs_status_check;
ALTER TABLE briefs ADD CONSTRAINT briefs_status_check
  CHECK (status IN ('planned','queued','active','completed','cancelled'));
