-- Migration 152: node_author_locks table
--
-- Phase 6.B — Author Lock (Category 1).
--
-- Per Phase 6 wireframe + decisions D1-D5: each row represents one
-- author-set lock on one node. Locks are per-node with no implicit
-- cascade (D2). Bulk operations create N rows with shared
-- bulk_operation_id for UX grouping (D2). Reason is optional with
-- suggestions surfaced from platform_config (D4). Org owners can
-- force-unlock with audit (D5).
--
-- Replaces the nodes.locked / lock_reason / locked_at / locked_version
-- columns added in M-004. Those columns are dropped in M-154.
--
-- check_node_writable (M-150) is updated by M-153 to read this table
-- instead of nodes.locked.

CREATE TABLE node_author_locks (
  node_id            UUID NOT NULL PRIMARY KEY REFERENCES nodes(id) ON DELETE CASCADE,
  organisation_id    UUID NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  locked_by_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  locked_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lock_reason        TEXT,
  bulk_operation_id  UUID  -- NULL for solo locks; shared UUID for bulk-locked groups
);

CREATE INDEX idx_node_author_locks_org      ON node_author_locks(organisation_id);
CREATE INDEX idx_node_author_locks_bulk_op  ON node_author_locks(bulk_operation_id) WHERE bulk_operation_id IS NOT NULL;
CREATE INDEX idx_node_author_locks_user     ON node_author_locks(locked_by_user_id);

ALTER TABLE node_author_locks ENABLE ROW LEVEL SECURITY;

-- Read: org members can see locks on nodes in their org.
CREATE POLICY "org_members_read_author_locks" ON node_author_locks
  FOR SELECT USING (
    organisation_id IN (
      SELECT organisation_id FROM organisation_members WHERE user_id = auth.uid()
    )
  );

-- Write: only through SECURITY DEFINER RPCs (M-153). No direct INSERT/
-- UPDATE/DELETE from authenticated role.
-- (No INSERT/UPDATE/DELETE policy = denied for non-service-role.)

-- Backfill: migrate any rows currently at nodes.locked=TRUE to the new
-- table. Audit run 2026-05-17 on local DB shows 1 such row (test data).
-- Cloud audit at deploy time will confirm.
INSERT INTO node_author_locks (node_id, organisation_id, locked_by_user_id, locked_at, lock_reason)
SELECT
  n.id,
  n.organisation_id,
  -- Use organisation's first member as the backfill locked_by. There's
  -- no audit trail on the old columns so we can't know who set the lock.
  (SELECT user_id FROM organisation_members WHERE organisation_id = n.organisation_id LIMIT 1),
  COALESCE(n.locked_at, n.updated_at, NOW()),
  n.lock_reason
FROM nodes n
WHERE n.locked = TRUE
ON CONFLICT (node_id) DO NOTHING;

COMMENT ON TABLE node_author_locks IS
  'Phase 6 Category 1 Author Lock — durable per-node author intent. One row per locked node. Bulk operations share bulk_operation_id for UX grouping. Replaces the nodes.locked/lock_reason/locked_at/locked_version columns.';
