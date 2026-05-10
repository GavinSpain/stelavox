-- Migration 041 — nodes.created_by / last_modified_by become UUID FK
-- to auth.users (round-3 audit B4.4, F-268).
--
-- Pre-fix:
--   nodes.created_by              TEXT NOT NULL DEFAULT 'user'
--   nodes.last_modified_by        TEXT NOT NULL DEFAULT 'user'
--
-- The TEXT-with-'user' pattern obscures who actually wrote which node
-- — every existing row has the literal string 'user', so the audit
-- trail is structurally absent. Audit F-268's recommendation:
-- `UUID REFERENCES auth.users(id)`.
--
-- (Pre-flight check found node_attachments.created_by and
-- scheduled_jobs.created_by are *already* UUID with FK to auth.users.
-- They originally appeared FK-less to a faulty information_schema
-- query; \d node_attachments / \d scheduled_jobs confirms the FKs
-- exist. Only the nodes table needs fixing.)
--
-- This migration:
--   1. Drops the TEXT default + NOT NULL on nodes.{created_by,last_modified_by}
--   2. ALTERs them to UUID via USING (NULL::uuid) — every existing row
--      becomes NULL (the literal 'user' string was a placeholder anyway,
--      not real audit data; lossless for forensic purposes).
--   3. Adds FK constraints with ON DELETE SET NULL — when a user is
--      deleted, their audit trail rows survive but with NULL author.
--
-- Disposable test data: this migration nullifies all 2683 nodes' audit
-- columns. Acceptable pre-launch — the existing values were
-- placeholders, not real audit data.

ALTER TABLE nodes
  ALTER COLUMN created_by DROP DEFAULT,
  ALTER COLUMN last_modified_by DROP DEFAULT,
  ALTER COLUMN created_by DROP NOT NULL,
  ALTER COLUMN last_modified_by DROP NOT NULL,
  ALTER COLUMN created_by TYPE UUID USING (NULL::uuid),
  ALTER COLUMN last_modified_by TYPE UUID USING (NULL::uuid);

ALTER TABLE nodes
  ADD CONSTRAINT nodes_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT nodes_last_modified_by_fkey
    FOREIGN KEY (last_modified_by) REFERENCES auth.users(id) ON DELETE SET NULL;
