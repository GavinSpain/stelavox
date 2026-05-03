-- Migration 021 — move_node RPC
-- Phase 2 task T-1.2 (H-04 hazard work)
-- Spec: stelavox_phase2_api_contract_v1_0.md §3.6
--       stelavox_phase2_test_plan_v1_0.md TC-A-75..TC-A-94, TC-D-01..TC-D-12
--       stelavox_technical_architecture_v1_4.md §5 H-04 (atomic sibling renumber)
--                                               §5 H-13 (SECURITY DEFINER search_path)
--
-- Atomically moves a node to a new parent and/or position. The function:
--   1. Locks moved node and new parent (FOR UPDATE)         — concurrency / TC-D-12
--   2. Validates membership (skipped for service_role)
--   3. Validates new parent (exists, same document, structural)
--   4. Cycle detection (recursive CTE over moved node's descendants)
--   5. Lock chain check on moved node, its ancestors, and new parent's ancestors
--   6. Layer-hierarchy validation (node_type matches layer at parent.layer_index+1)
--   7. Position bounds check
--   8. No-op short-circuit (same parent, same order)
--   9. Tight-range sibling renumber:
--        - within-parent UP   shift [new_order, old_order-1] +1
--        - within-parent DOWN shift [old_order+1, new_order] -1
--        - cross-parent       close old gap (decrement) + open new slot (increment)
--      Each statement updates each row at most once. No intermediate duplicate orders.
--  10. Move the node (parent_id, order, depth, layer_index, updated_at)
--  11. Recursive depth + layer_index delta-update on descendants when delta != 0
--  12. Return { node, renumbered_count }
--
-- All steps run inside a single PL/pgSQL transaction.
-- Errors are raised with token-prefixed messages so the API route's
-- substring-match dispatcher (route.ts:56 pattern) can map them to HTTP status.
--
-- Error tokens → HTTP status (mapped in app/api/nodes/[id]/move/route.ts, T-3.5):
--   not_found        → 404
--   forbidden        → 401
--   invalid_parent   → 422
--   cycle_detected   → 422
--   layer_violation  → 422
--   invalid_position → 400
--   node_locked      → 423
--   parent_locked    → 423

CREATE OR REPLACE FUNCTION move_node(
  p_node_id   UUID,
  p_parent_id UUID,
  p_position  INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_moved          nodes%ROWTYPE;
  v_new_parent     nodes%ROWTYPE;
  v_caller         UUID := auth.uid();
  v_layers         JSONB;
  v_expected_type  TEXT;
  v_child_count    INTEGER;
  v_max_position   INTEGER;
  v_delta          INTEGER;
  v_old_shift      INTEGER := 0;
  v_new_shift      INTEGER := 0;
  v_renumbered     INTEGER;
BEGIN
  ----------------------------------------------------------------------------
  -- Step 1. Lock and load moved node.
  ----------------------------------------------------------------------------
  SELECT * INTO v_moved FROM nodes WHERE id = p_node_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: node % does not exist', p_node_id
      USING ERRCODE = 'no_data_found';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 2. Membership check (skipped for service_role per M-019 pattern).
  ----------------------------------------------------------------------------
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_moved.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_moved.organisation_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  ----------------------------------------------------------------------------
  -- Step 3. Lock and load new parent. Must exist, share the document, and be
  --         a structural node.
  ----------------------------------------------------------------------------
  SELECT * INTO v_new_parent FROM nodes WHERE id = p_parent_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_parent: parent % does not exist', p_parent_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_new_parent.document_id IS DISTINCT FROM v_moved.document_id THEN
    RAISE EXCEPTION 'invalid_parent: parent % is in a different document', p_parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_new_parent.node_category <> 'structural' THEN
    RAISE EXCEPTION 'invalid_parent: parent % is not a structural node', p_parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 4. Cycle detection.
  -- Build the closure of the moved node (itself + all descendants) and reject
  -- if the requested parent is in this set. Self-cycle (p_parent_id = p_node_id)
  -- is caught here too.
  ----------------------------------------------------------------------------
  IF EXISTS (
    WITH RECURSIVE moved_closure AS (
      SELECT id FROM nodes WHERE id = p_node_id
      UNION ALL
      SELECT n.id FROM nodes n JOIN moved_closure c ON n.parent_id = c.id
    )
    SELECT 1 FROM moved_closure WHERE id = p_parent_id
  ) THEN
    RAISE EXCEPTION 'cycle_detected: parent % is the moved node or its descendant', p_parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 5. Lock-chain check.
  --   (a) moved node itself locked        → node_locked
  --   (b) any ancestor of moved locked    → parent_locked
  --   (c) new parent or any of its
  --       ancestors locked                 → parent_locked
  ----------------------------------------------------------------------------
  IF v_moved.locked THEN
    RAISE EXCEPTION 'node_locked: moved node % is locked', p_node_id
      USING ERRCODE = 'lock_not_available';
  END IF;

  IF v_moved.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, locked FROM nodes WHERE id = v_moved.parent_id
      UNION ALL
      SELECT n.id, n.parent_id, n.locked
        FROM nodes n JOIN ancestors a ON n.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE locked = TRUE
  ) THEN
    RAISE EXCEPTION 'parent_locked: an ancestor of moved node % is locked', p_node_id
      USING ERRCODE = 'lock_not_available';
  END IF;

  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id, locked FROM nodes WHERE id = p_parent_id
      UNION ALL
      SELECT n.id, n.parent_id, n.locked
        FROM nodes n JOIN ancestors a ON n.id = a.parent_id
    )
    SELECT 1 FROM ancestors WHERE locked = TRUE
  ) THEN
    RAISE EXCEPTION 'parent_locked: new parent % or one of its ancestors is locked', p_parent_id
      USING ERRCODE = 'lock_not_available';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 6. Layer-hierarchy validation.
  -- The new layer index = new_parent.layer_index + 1. Out-of-bounds means
  -- the new parent is a leaf-layer node (max_depth) — surfaced as
  -- layer_violation per API Contract §3.6 step 8.
  ----------------------------------------------------------------------------
  SELECT layers INTO v_layers
    FROM layer_stacks
   WHERE document_id = v_moved.document_id
     AND is_template = FALSE
   LIMIT 1;

  IF v_layers IS NULL THEN
    -- Should not occur post-M020 (every document has exactly one forked stack).
    RAISE EXCEPTION 'invalid_parent: document % has no layer stack', v_moved.document_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_expected_type := v_layers->(v_new_parent.layer_index + 1)->>'node_type';

  IF v_expected_type IS NULL THEN
    RAISE EXCEPTION 'layer_violation: parent at layer % is a leaf and admits no children',
                    v_new_parent.layer_index
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_moved.node_type <> v_expected_type THEN
    RAISE EXCEPTION 'layer_violation: node_type % does not match expected % at layer %',
                    v_moved.node_type, v_expected_type, v_new_parent.layer_index + 1
      USING ERRCODE = 'check_violation';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 7. Position bounds.
  -- Cross-parent:  [0, child_count]
  -- Within-parent: [0, child_count - 1]   (moved is already in the count)
  ----------------------------------------------------------------------------
  IF p_position < 0 THEN
    RAISE EXCEPTION 'invalid_position: position % is negative', p_position
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COUNT(*) INTO v_child_count FROM nodes WHERE parent_id = p_parent_id;

  IF p_parent_id IS NOT DISTINCT FROM v_moved.parent_id THEN
    v_max_position := v_child_count - 1;
  ELSE
    v_max_position := v_child_count;
  END IF;

  IF p_position > v_max_position THEN
    RAISE EXCEPTION 'invalid_position: position % exceeds max % for parent %',
                    p_position, v_max_position, p_parent_id
      USING ERRCODE = 'check_violation';
  END IF;

  ----------------------------------------------------------------------------
  -- Step 8. No-op short-circuit.
  -- Same parent, position equals current order-1 → unchanged tree, count = 0.
  ----------------------------------------------------------------------------
  IF p_parent_id IS NOT DISTINCT FROM v_moved.parent_id
     AND (p_position + 1) = v_moved."order" THEN
    RETURN jsonb_build_object(
      'node',             (SELECT row_to_json(n) FROM nodes n WHERE n.id = p_node_id),
      'renumbered_count', 0
    );
  END IF;

  ----------------------------------------------------------------------------
  -- Step 9. Sibling renumber. Tight, non-overlapping ranges; each row updated
  -- at most once; no intermediate duplicate orders.
  ----------------------------------------------------------------------------
  IF p_parent_id IS NOT DISTINCT FROM v_moved.parent_id THEN
    -- Within-parent move.
    IF (p_position + 1) < v_moved."order" THEN
      -- UP: shift siblings in [new_order, old_order - 1] up by 1.
      -- The moved row is at old_order, excluded by "order < old_order".
      UPDATE nodes
         SET "order"    = "order" + 1,
             updated_at = NOW()
       WHERE parent_id = v_moved.parent_id
         AND "order"  >= p_position + 1
         AND "order"  <  v_moved."order";
      GET DIAGNOSTICS v_new_shift = ROW_COUNT;
    ELSE
      -- DOWN: shift siblings in [old_order + 1, new_order] down by 1.
      -- The moved row is at old_order, excluded by "order > old_order".
      UPDATE nodes
         SET "order"    = "order" - 1,
             updated_at = NOW()
       WHERE parent_id = v_moved.parent_id
         AND "order"  >  v_moved."order"
         AND "order"  <= p_position + 1;
      GET DIAGNOSTICS v_new_shift = ROW_COUNT;
    END IF;
    v_renumbered := v_new_shift + 1;  -- +1 for the moved node itself
  ELSE
    -- Cross-parent move.
    -- Close gap in old parent: shift siblings with order > moved.order down.
    UPDATE nodes
       SET "order"    = "order" - 1,
           updated_at = NOW()
     WHERE parent_id = v_moved.parent_id
       AND "order"  >  v_moved."order";
    GET DIAGNOSTICS v_old_shift = ROW_COUNT;

    -- Open slot in new parent: shift siblings with order >= position+1 up.
    UPDATE nodes
       SET "order"    = "order" + 1,
           updated_at = NOW()
     WHERE parent_id = p_parent_id
       AND "order"  >= p_position + 1;
    GET DIAGNOSTICS v_new_shift = ROW_COUNT;

    v_renumbered := v_old_shift + v_new_shift + 1;  -- +1 for the moved node
  END IF;

  ----------------------------------------------------------------------------
  -- Step 10. Update the moved node.
  -- depth and layer_index move in lock-step (structural-node invariant
  -- per spec §2.11 invariants 4 and 6).
  ----------------------------------------------------------------------------
  v_delta := (v_new_parent.depth + 1) - v_moved.depth;

  UPDATE nodes
     SET parent_id   = p_parent_id,
         "order"     = p_position + 1,
         depth       = v_new_parent.depth + 1,
         layer_index = v_new_parent.layer_index + 1,
         updated_at  = NOW()
   WHERE id = p_node_id;

  ----------------------------------------------------------------------------
  -- Step 11. Recursive descendant depth + layer_index update (delta != 0).
  -- NULL-safe for context-node descendants whose layer_index IS NULL
  -- (NULL + delta = NULL in PostgreSQL).
  ----------------------------------------------------------------------------
  IF v_delta <> 0 THEN
    WITH RECURSIVE descendants AS (
      SELECT id FROM nodes WHERE parent_id = p_node_id
      UNION ALL
      SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
    )
    UPDATE nodes
       SET depth       = depth + v_delta,
           layer_index = layer_index + v_delta,
           updated_at  = NOW()
     WHERE id IN (SELECT id FROM descendants);
  END IF;

  ----------------------------------------------------------------------------
  -- Step 12. Return.
  ----------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'node',             (SELECT row_to_json(n) FROM nodes n WHERE n.id = p_node_id),
    'renumbered_count', v_renumbered
  );
END;
$$;

REVOKE ALL ON FUNCTION move_node(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_node(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION move_node(UUID, UUID, INTEGER) TO service_role;
