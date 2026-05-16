-- Migration 154: drop nodes.locked / lock_reason / locked_at / locked_version
--
-- Phase 6.B — Author Lock (Category 1).
--
-- node_author_locks (M-152) is now the source of truth for Category 1
-- locks. check_node_writable (M-153) was switched to read it. The old
-- nodes columns are now redundant. Backfill in M-152 preserved any
-- existing locks; this migration removes the dead columns.
--
-- The PATCH route already rejects direct writes to `locked` /
-- `lock_reason` via nodePatchSchema (Phase 2). Phase 6 routes write
-- to node_author_locks through the dedicated POST/DELETE
-- /api/nodes/[id]/lock endpoints. Dropping the columns is safe.

-- The M-047 nodes_canonical view exposes nodes.locked etc. Drop it
-- first; recreate below without the lock columns.
DROP VIEW IF EXISTS nodes_canonical;

ALTER TABLE nodes DROP COLUMN locked;
ALTER TABLE nodes DROP COLUMN lock_reason;
ALTER TABLE nodes DROP COLUMN locked_at;
ALTER TABLE nodes DROP COLUMN locked_version;

-- Recreate the canonical-order view (same recursive shape from M-047),
-- now without the four lock columns. Clients consume canonical_position
-- and other derived fields; the lock columns weren't used by the view's
-- consumers (Director get_nodes_by_layer reads canonical_position only).
CREATE VIEW nodes_canonical AS
WITH RECURSIVE walk AS (
  SELECT nodes.id,
         ARRAY[nodes."order"] AS ordinal_path
    FROM nodes
   WHERE nodes.parent_id IS NULL
  UNION ALL
  SELECT n_1.id,
         w_1.ordinal_path || n_1."order"
    FROM nodes n_1
    JOIN walk w_1 ON n_1.parent_id = w_1.id
)
SELECT n.id,
       n.organisation_id,
       n.document_id,
       n.project_id,
       n.node_category,
       n.node_type,
       n.parent_id,
       n."order",
       n.depth,
       n.layer_index,
       n.scope,
       n.version,
       n.created_at,
       n.updated_at,
       n.created_by,
       n.last_modified_by,
       n.name,
       n.short_description,
       n.tags,
       n.summary,
       n.prose,
       n.notes,
       n.metadata,
       n.status,
       n.agent_instruction,
       n.word_count_target,
       n.word_count_actual,
       n.mobile_notes,
       n.attachment_count,
       n.export_include,
       n.export_heading_override,
       n.export_page_break_before,
       n.external_ref,
       n.content_revision,
       w.ordinal_path,
       row_number() OVER (PARTITION BY n.document_id ORDER BY w.ordinal_path) AS canonical_position
  FROM nodes n
  JOIN walk w ON n.id = w.id;

COMMENT ON TABLE nodes IS
  'Per Phase 6 M-154, the locked/lock_reason/locked_at/locked_version columns are dropped. Author Lock state lives in node_author_locks. Edit Sessions live in node_locks. Agent In-Flight state is derived from agent_jobs.';
