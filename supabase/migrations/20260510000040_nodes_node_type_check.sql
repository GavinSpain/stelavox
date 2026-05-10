-- Migration 040 — CHECK constraint on nodes.node_type (round-3 audit B4.3, F-267).
--
-- Pre-fix `node_type TEXT NOT NULL` accepted any string. Validation
-- lived only at the API layer (Zod) and at lib/context/types.ts;
-- direct DB writes (service-role from runner.ts, workflow-executor's
-- auto-create-context-node F-113, ad-hoc psql) bypassed validation.
--
-- The constraint enforces the V1 whitelist at the DB layer:
--   structural: book, series, story, act, chapter, scene, beat
--   context:    character, location, organisation, theme, plot_thread, world
--
-- It also ties node_type to node_category — a context-category row
-- can't carry a structural node_type and vice versa. This catches a
-- class of category-confusion bugs (e.g. workflow-executor's
-- auto-create-context-node accidentally inserting a node with
-- node_type='chapter' and node_category='context').
--
-- Verified pre-flight: SELECT DISTINCT node_type, node_category FROM
-- nodes returns only the 11 (type, category) pairs that satisfy this
-- constraint. No existing rows violate it.

ALTER TABLE nodes
  ADD CONSTRAINT nodes_node_type_check
  CHECK (
    (node_category = 'structural' AND node_type IN (
      'book', 'series', 'story', 'act', 'chapter', 'scene', 'beat'
    ))
    OR
    (node_category = 'context' AND node_type IN (
      'character', 'location', 'organisation', 'theme', 'plot_thread', 'world'
    ))
  );
