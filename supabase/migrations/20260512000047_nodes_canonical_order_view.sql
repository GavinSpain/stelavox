-- Migration 047 — nodes_canonical VIEW with depth-first ordinal_path + canonical_position.
--
-- V1.x-LB launch-blocker fix-pack, B1.
-- Source: docs/stelavox_director_architecture_v2_0.md §7.1.
--
-- Bug. The Director's get_nodes_by_layer read tool queried `nodes` and
-- ordered by `"order"` only. PostgreSQL has no defined cross-parent
-- tiebreak for intra-parent integer order, so "all scenes in this
-- document" came back in implementation-defined order. The 2026-05-10
-- launch test confirmed: a "next 10 scenes" batch landed canonical
-- positions {39, 46, 47, 77, 83, 84, 89, 90, 95, 109} — scattered, not
-- contiguous. Director workflow titles read "scenes 11–20" while the
-- underlying selection was wrong; user trust failure.
--
-- Fix. Build a VIEW that exposes every column on `nodes` plus
-- `ordinal_path INTEGER[]`, the array of `order` values from root to
-- node, produced by a recursive CTE. Lexicographic sort on
-- `ordinal_path` is canonical depth-first order. A `canonical_position`
-- scalar gives "Nth node in canonical order within document" — used by
-- launch-blocker B3 (batch-N start-position derivation) and by future
-- range-validation logic in the workflow executor.
--
-- security_invoker = true. The view inherits RLS from the underlying
-- nodes table policy ("org_members_access_nodes" — Migration 002) and
-- runs the recursive CTE in the caller's auth context. No SECURITY
-- DEFINER and no H-13 search_path concern. Service-role callers
-- (Director read tools) bypass RLS as expected; they continue to scope
-- by organisation_id + document_id at the query level for defence in
-- depth.
--
-- Performance. The recursive CTE walks the entire nodes table per
-- query, indexed by `idx_nodes_parent_id` (Migration 002). For V1
-- scale (single document × low thousands of nodes) this is O(n) and
-- bounded; profiling can promote to a materialized view + trigger
-- later if it surfaces as a hotspot. Read tools filter by document_id
-- before the sort, so the working set is one document's tree.

CREATE OR REPLACE VIEW nodes_canonical
WITH (security_invoker = true)
AS
WITH RECURSIVE walk AS (
  SELECT
    id,
    ARRAY["order"]::INTEGER[] AS ordinal_path
  FROM nodes
  WHERE parent_id IS NULL

  UNION ALL

  SELECT
    n.id,
    w.ordinal_path || n."order"
  FROM nodes n
  JOIN walk w ON n.parent_id = w.id
)
SELECT
  n.*,
  w.ordinal_path,
  ROW_NUMBER() OVER (
    PARTITION BY n.document_id
    ORDER BY w.ordinal_path
  ) AS canonical_position
FROM nodes n
JOIN walk w ON n.id = w.id;

COMMENT ON VIEW nodes_canonical IS
  'Director canonical-order projection of nodes. ordinal_path is the array of "order" values from root to node; canonical_position is the 1-based rank within document_id under depth-first sort. Source: Migration 047, V1.x-LB launch-blocker B1.';
