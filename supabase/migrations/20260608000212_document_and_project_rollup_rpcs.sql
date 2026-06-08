-- Migration: get_document_rollup + get_project_rollup RPCs
--
-- Phase 8.5b — Sub-phase B.1 (Rollup correctness).
-- Refs: docs/stelavox_document_load_architecture_v1_0.md §4 + §2.3 / §2.4
--       docs/stelavox_phase8_5b_build_checklist_v1_0.md §1 (B.1 Work items)
--       docs/stelavox_phase8_5b_test_plan_v1_0.md §1 (TC-8.5b-B1-01..14)
--
-- ─── Why this migration ─────────────────────────────────────────────────
--
-- The dashboard ProjectCard and document-page header read aggregate values
-- (wordsDrafted, wordsTarget, lastUpdated) computed today by fetching all
-- structural nodes from `nodes` into TypeScript and summing client-side.
-- That pattern hits PostgREST's default 1000-row response limit silently,
-- under-reporting on any document over ~1000 nodes. The Phase 8.5 baseline
-- caught this against the seeded 500k-word "Mega Manuscript" fixture:
-- dashboard displayed 187,206 words instead of the real 500,006.
--
-- This migration moves the aggregation to Postgres, where the row cap
-- doesn't apply and the work runs sub-50 ms for typical document sizes.
-- The aggregate semantics are preserved exactly:
--   - words_drafted = SUM(word_count_actual) FILTER (WHERE is_leaf)
--   - is_leaf      = (layer_index = MAX(layer_index) per document)
--                    per H-15 (leaf-ness is a layer-stack property)
--   - words_target = root node target if > 0, otherwise sum of leaf targets
--                    (mirrors the existing TS logic in projectAggregates.ts
--                     line 156: `b.rootTarget > 0 ? b.rootTarget : b.leafTargetFallback`)
--
-- ─── RPC contracts ─────────────────────────────────────────────────────
--
-- get_document_rollup(p_document_id UUID) → one row per call:
--   document_id, words_drafted, words_target,
--   node_count, leaf_count, status_counts (JSONB), last_updated_at
--
-- get_project_rollup(p_project_id UUID) → one row per call:
--   project_id, document_count, words_drafted, words_target,
--   node_count, leaf_count, last_updated_at
--
-- Both functions:
--   - LANGUAGE sql STABLE  — pure deterministic-per-snapshot reads
--   - SECURITY INVOKER     — runs with caller's privileges so RLS on the
--                            underlying `nodes` query scopes the aggregate
--                            to what the caller is authorised to see. An
--                            anon-client cross-org call sees zero rows
--                            in the inner SELECT and the COALESCE branch
--                            returns the zero-filled aggregate row.
--                            Service-role callers bypass RLS via the
--                            standard service-role role assignment.
--                            Verified by TC-8.5b-B1-06.
--   - SET search_path = public  — H-13 compliance even on INVOKER bodies
--                                 (search_path injection is independent of
--                                  the SECURITY mode).
--
-- ─── Index audit ────────────────────────────────────────────────────────
--
-- Existing index `idx_nodes_document_id` covers the document-scoped
-- aggregate scan. Existing `idx_nodes_project_id` covers the project
-- variant. We add a composite `(document_id, layer_index)` index to
-- accelerate the MAX(layer_index) subquery — without it, computing
-- `is_leaf` requires a full document-scoped scan to find the max layer.
-- IF NOT EXISTS so the migration is idempotent.
--
-- ─── Empty cases ────────────────────────────────────────────────────────
--
-- The CTE chain handles empty inputs naturally:
--   - Empty document    → per_doc_max returns NULL → enriched is empty
--                         → outer SELECT returns one row with zeros
--   - Empty project     → docs CTE returns 0 rows → document_count = 0,
--                         other aggregates default to 0
-- TC-8.5b-B1-05 verifies the empty document case explicitly.
--
-- ─── Roll-out ──────────────────────────────────────────────────────────
--
-- No data migration. No state change. Adds two RPCs and one index.
-- Pre-existing aggregate code paths continue to work (rewritten in the
-- same sub-phase to call these RPCs; see B.1 Work items §6-§9).

-- ─── Index ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_nodes_document_id_layer_index
  ON nodes(document_id, layer_index)
  WHERE node_category = 'structural';

COMMENT ON INDEX idx_nodes_document_id_layer_index IS
  'Phase 8.5b B.1 — accelerates MAX(layer_index) lookups for rollup RPCs.';

-- ─── get_document_rollup ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_document_rollup(p_document_id UUID)
RETURNS TABLE (
  document_id UUID,
  words_drafted BIGINT,
  words_target BIGINT,
  node_count INT,
  leaf_count INT,
  status_counts JSONB,
  last_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH max_layer AS (
    SELECT COALESCE(MAX(n.layer_index), -1) AS m
    FROM nodes n
    WHERE n.document_id = p_document_id
      AND n.node_category = 'structural'
  ),
  enriched AS (
    SELECT
      n.id,
      n.parent_id,
      n.layer_index,
      n.word_count_actual,
      n.word_count_target,
      n.status,
      n.updated_at,
      (n.layer_index = (SELECT m FROM max_layer) AND (SELECT m FROM max_layer) >= 0) AS is_leaf,
      (n.parent_id IS NULL) AS is_root
    FROM nodes n
    WHERE n.document_id = p_document_id
      AND n.node_category = 'structural'
  ),
  targets AS (
    SELECT
      COALESCE(SUM(word_count_target) FILTER (WHERE is_root), 0)::BIGINT AS root_target,
      COALESCE(SUM(word_count_target) FILTER (WHERE is_leaf), 0)::BIGINT AS leaf_target
    FROM enriched
  ),
  status_dist AS (
    SELECT COALESCE(jsonb_object_agg(s.status, s.cnt), '{}'::jsonb) AS counts
    FROM (
      SELECT status, COUNT(*) AS cnt FROM enriched GROUP BY status
    ) s
  )
  SELECT
    p_document_id AS document_id,
    COALESCE(SUM(word_count_actual) FILTER (WHERE is_leaf), 0)::BIGINT AS words_drafted,
    CASE
      WHEN (SELECT root_target FROM targets) > 0 THEN (SELECT root_target FROM targets)
      ELSE (SELECT leaf_target FROM targets)
    END AS words_target,
    COUNT(*)::INT AS node_count,
    COUNT(*) FILTER (WHERE is_leaf)::INT AS leaf_count,
    (SELECT counts FROM status_dist) AS status_counts,
    MAX(updated_at) AS last_updated_at
  FROM enriched;
$$;

COMMENT ON FUNCTION get_document_rollup(UUID) IS
  'Phase 8.5b B.1 — returns aggregate counts for one document. Replaces TypeScript-side row-sum patterns that hit the PostgREST 1000-row cap.';

GRANT EXECUTE ON FUNCTION get_document_rollup(UUID) TO authenticated, anon, service_role;

-- ─── get_project_rollup ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_project_rollup(p_project_id UUID)
RETURNS TABLE (
  project_id UUID,
  document_count INT,
  words_drafted BIGINT,
  words_target BIGINT,
  node_count INT,
  leaf_count INT,
  last_updated_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH docs AS (
    SELECT id FROM documents WHERE documents.project_id = p_project_id
  ),
  per_doc_max AS (
    SELECT n.document_id AS doc_id, MAX(n.layer_index) AS max_idx
    FROM nodes n
    WHERE n.project_id = p_project_id
      AND n.node_category = 'structural'
    GROUP BY n.document_id
  ),
  enriched AS (
    SELECT
      n.id,
      n.document_id,
      n.parent_id,
      n.layer_index,
      n.word_count_actual,
      n.word_count_target,
      n.status,
      n.updated_at,
      (n.layer_index = pdm.max_idx) AS is_leaf,
      (n.parent_id IS NULL) AS is_root
    FROM nodes n
    JOIN per_doc_max pdm ON pdm.doc_id = n.document_id
    WHERE n.project_id = p_project_id
      AND n.node_category = 'structural'
  ),
  per_doc_targets AS (
    SELECT
      document_id,
      COALESCE(SUM(word_count_target) FILTER (WHERE is_root), 0)::BIGINT AS root_t,
      COALESCE(SUM(word_count_target) FILTER (WHERE is_leaf), 0)::BIGINT AS leaf_t
    FROM enriched
    GROUP BY document_id
  ),
  per_doc_effective_target AS (
    SELECT
      document_id,
      CASE WHEN root_t > 0 THEN root_t ELSE leaf_t END AS effective_target
    FROM per_doc_targets
  )
  SELECT
    p_project_id AS project_id,
    (SELECT COUNT(*)::INT FROM docs) AS document_count,
    COALESCE(SUM(word_count_actual) FILTER (WHERE is_leaf), 0)::BIGINT AS words_drafted,
    COALESCE((SELECT SUM(effective_target)::BIGINT FROM per_doc_effective_target), 0) AS words_target,
    COUNT(*)::INT AS node_count,
    COUNT(*) FILTER (WHERE is_leaf)::INT AS leaf_count,
    MAX(updated_at) AS last_updated_at
  FROM enriched;
$$;

COMMENT ON FUNCTION get_project_rollup(UUID) IS
  'Phase 8.5b B.1 — returns aggregate counts for one project (summed across its documents). Replaces TypeScript-side row-sum patterns that hit the PostgREST 1000-row cap.';

GRANT EXECUTE ON FUNCTION get_project_rollup(UUID) TO authenticated, anon, service_role;
