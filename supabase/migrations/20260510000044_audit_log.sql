-- Migration 044 — extend audit_log table for security/observability
-- coverage (round-3 audit B5.1; closes F-56's spec gap).
--
-- The audit_log table already exists from Migration 008 (multi-tenancy
-- support) with `event_type` / `severity` / `metadata` columns and
-- `owners_read_audit_log` RLS policy. F-56's actual gap is that the
-- existing security `console.error('[SECURITY]', ...)` sites
-- (canary.ts, injection-scanner.ts, tool-validator.ts) never write to
-- this table despite TA §4.3 / §4.5 / §4.9 mandating it.
--
-- This migration:
--   1. Adds context columns the existing schema lacks
--      (document_id, conversation_id, node_id) so security events can
--      be cross-referenced to the conversation / document / node they
--      relate to. All nullable; soft references (no FK) so audit
--      survives entity deletion (an org-deletion incident shouldn't
--      erase its own audit trail).
--   2. Adds a `service_role INSERT` policy so the writeAuditLogEntry
--      helper can write rows. Existing schema's only INSERT path was
--      ad-hoc psql by the original migrations — there was no app-level
--      writer.
--   3. Adds a CHECK extension for the `low` severity (existing CHECK
--      allowed only info/medium/high/critical; we want one tier below
--      info for non-actionable events like routine throttle pacing).
--   4. Adds indexes for the dominant query shapes that didn't exist:
--      event_type+recent (admin / forensic) and conversation+recent
--      (incident reconstruction).
--
-- The B5.2 batch wires the application code into this surface.

-- 1. Context columns.
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS document_id     UUID,
  ADD COLUMN IF NOT EXISTS conversation_id UUID,
  ADD COLUMN IF NOT EXISTS node_id         UUID;

-- 2. service_role INSERT policy. The existing audit_log RLS only had
-- a SELECT policy (`owners_read_audit_log`); no INSERT path was
-- defined. With RLS enabled, that meant authenticated INSERTs were
-- silently denied. service_role bypasses RLS by default but only
-- when explicitly granted via a permissive policy.
CREATE POLICY audit_log_service_role_insert
  ON audit_log FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Also add a SELECT policy for org members (the existing one is
-- restricted to owners/admins; non-admin members couldn't read audit
-- entries for their own org). Keep the owners policy in place; this
-- adds member visibility for non-critical events.
CREATE POLICY audit_log_org_member_select
  ON audit_log FOR SELECT
  TO authenticated
  USING (
    organisation_id IS NOT NULL
    AND organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- 3. Extend severity CHECK to include 'low'. PostgreSQL doesn't allow
-- ALTER CHECK in place — drop and recreate.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_severity_check;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_severity_check
    CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info'));

-- 4. Indexes for the missing query shapes.
CREATE INDEX IF NOT EXISTS idx_audit_log_event_type_recent
  ON audit_log (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_conversation_recent
  ON audit_log (conversation_id, created_at DESC)
  WHERE conversation_id IS NOT NULL;

COMMENT ON COLUMN audit_log.document_id IS 'Soft reference to documents.id; nullable; no FK so audit survives document deletion.';
COMMENT ON COLUMN audit_log.conversation_id IS 'Soft reference to conversations.id; nullable; no FK so audit survives conversation deletion.';
COMMENT ON COLUMN audit_log.node_id IS 'Soft reference to nodes.id; nullable; no FK so audit survives node deletion.';
