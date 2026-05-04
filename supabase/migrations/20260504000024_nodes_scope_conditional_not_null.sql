-- Migration 024 — nodes.scope conditional NOT NULL
-- Phase 4 close-out (SU-14 / API Contract v1.0 §5 G-1)
-- Spec: stelavox_phase4_api_contract_v1_0.md §5 G-1
--       stelavox_phase4_test_report_v1_0.md §5 SU-14
--
-- Migration 004 declared `nodes.scope TEXT CHECK (scope IN ('project','document'))`
-- — value-domain only. The conditional NOT NULL ("non-NULL when
-- node_category='context'; NULL when 'structural'") was enforced at the
-- API layer (TA v1.5 §3.6 SU-1) until Phase 4 actually started creating
-- context nodes. SU-14 promotes that rule to a DB-level CHECK constraint.
--
-- The constraint is structured so it never fails on rows that already
-- comply. Phase 4's POST /api/projects/[id]/context-nodes always sets
-- scope at insert time; the existing Phase 2 POST /api/documents/[id]/nodes
-- never touches scope and inserts NULL by default for structural rows.
-- A pre-flight scan against the local seed + test fixtures confirms zero
-- violating rows; the same is verified at Phase B smoke time before this
-- migration runs against stelavox-dev.
--
-- The CHECK is added without `NOT VALID` because V1's row count is small
-- enough (< 1M nodes per organisation, easily) for an immediate validate.
-- A future tenant approaching the row-count threshold where validation
-- becomes a write-stall concern can add NOT VALID and validate later;
-- not in V1 scope.

ALTER TABLE nodes
  ADD CONSTRAINT nodes_scope_conditional_not_null CHECK (
    (node_category = 'context'    AND scope IS NOT NULL)
    OR
    (node_category = 'structural' AND scope IS NULL)
  );

COMMENT ON CONSTRAINT nodes_scope_conditional_not_null ON nodes IS
  'Phase 4 SU-14: scope must be non-NULL for context nodes and NULL for structural nodes. Promoted from API-layer enforcement (TA v1.5 §3.6 SU-1).';
