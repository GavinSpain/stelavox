-- Migration 151: move_node — per-node lock checks (drop ancestor cascade)
--
-- Phase 6.A — Locking and Workflow / per-node lock semantics.
--
-- Per Phase 6 deep-dive decision D2: locks are per-node with no
-- implicit cascade. A locked Act 1 does NOT block writes to its
-- descendants unless those descendants are independently locked.
--
-- The M-021 move_node RPC implemented implicit cascade via two
-- recursive-CTE ancestor walks (Step 5 (b) for moved-node ancestors
-- and (c) for new-parent ancestors). Per D2 these are wrong — they
-- should check only:
--
--   - moved node itself (v_moved.locked) — being moved IS a write
--     on the moved node
--   - moved node's old parent — moving removes a child from old
--     parent's children list, a write on the old parent
--   - new parent (v_new_parent.locked) — moving adds a child to
--     new parent's children list, a write on the new parent
--
-- This migration re-bodies move_node with the per-node checks ONLY
-- in Step 5. All other logic from M-021 is preserved verbatim
-- (lock+load, membership, cycle detection, layer hierarchy, position
-- bounds, no-op short-circuit, sibling renumber, depth+layer_index
-- descendant updates).
--
-- Signature unchanged. Error tokens unchanged: node_locked /
-- parent_locked still used. parent_locked now refers to the immediate
-- old or new parent rather than any ancestor.

CREATE OR REPLACE FUNCTION move_node(
  p_node_id   UUID,
  p_parent_id UUID,
  p_position  INTEGER
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_moved          nodes%ROWTYPE;
  v_new_parent     nodes%ROWTYPE;
  v_old_parent_locked BOOLEAN;
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
  -- Step 1. Lock and load moved node.
  SELECT * INTO v_moved FROM nodes WHERE id = p_node_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: node % does not exist', p_node_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Step 2. Membership check (skipped for service_role).
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_moved.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_moved.organisation_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Step 3. Lock and load new parent.
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

  -- Step 4. Cycle detection (M-021 logic preserved).
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

  -- Step 5. PER-NODE lock check (Phase 6 D2 — REPLACES M-021's cascade).
  -- 5.a — moved node itself
  IF v_moved.locked THEN
    RAISE EXCEPTION 'node_locked: moved node % is locked', p_node_id
      USING ERRCODE = 'lock_not_available';
  END IF;

  -- 5.b — old parent (immediate only, no ancestor walk)
  IF v_moved.parent_id IS NOT NULL THEN
    SELECT locked INTO v_old_parent_locked FROM nodes WHERE id = v_moved.parent_id;
    IF v_old_parent_locked THEN
      RAISE EXCEPTION 'parent_locked: old parent % is locked', v_moved.parent_id
        USING ERRCODE = 'lock_not_available';
    END IF;
  END IF;

  -- 5.c — new parent (immediate only, no ancestor walk)
  IF v_new_parent.locked THEN
    RAISE EXCEPTION 'parent_locked: new parent % is locked', p_parent_id
      USING ERRCODE = 'lock_not_available';
  END IF;

  -- Step 6. Layer-hierarchy validation (M-021 logic preserved).
  SELECT layers INTO v_layers
    FROM layer_stacks
   WHERE document_id = v_moved.document_id
     AND is_template = FALSE
   LIMIT 1;

  IF v_layers IS NULL THEN
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

  -- Step 7. Position bounds (M-021 logic preserved — 0-based positions).
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

  -- Step 8. No-op short-circuit (M-021 logic preserved).
  IF p_parent_id IS NOT DISTINCT FROM v_moved.parent_id
     AND (p_position + 1) = v_moved."order" THEN
    RETURN jsonb_build_object(
      'node',             (SELECT row_to_json(n) FROM nodes n WHERE n.id = p_node_id),
      'renumbered_count', 0
    );
  END IF;

  -- Step 9. Sibling renumber (M-021 logic preserved verbatim).
  IF p_parent_id IS NOT DISTINCT FROM v_moved.parent_id THEN
    -- Within-parent move.
    IF (p_position + 1) < v_moved."order" THEN
      -- UP: shift siblings in [new_order, old_order - 1] up by 1.
      UPDATE nodes
         SET "order"    = "order" + 1,
             updated_at = NOW()
       WHERE parent_id = v_moved.parent_id
         AND "order"  >= p_position + 1
         AND "order"  <  v_moved."order";
      GET DIAGNOSTICS v_new_shift = ROW_COUNT;
    ELSE
      -- DOWN: shift siblings in [old_order + 1, new_order] down by 1.
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
    UPDATE nodes
       SET "order"    = "order" - 1,
           updated_at = NOW()
     WHERE parent_id = v_moved.parent_id
       AND "order"  >  v_moved."order";
    GET DIAGNOSTICS v_old_shift = ROW_COUNT;

    UPDATE nodes
       SET "order"    = "order" + 1,
           updated_at = NOW()
     WHERE parent_id = p_parent_id
       AND "order"  >= p_position + 1;
    GET DIAGNOSTICS v_new_shift = ROW_COUNT;

    v_renumbered := v_old_shift + v_new_shift + 1;
  END IF;

  -- Step 10. Update the moved node (M-021 logic preserved).
  v_delta := (v_new_parent.depth + 1) - v_moved.depth;

  UPDATE nodes
     SET parent_id   = p_parent_id,
         "order"     = p_position + 1,
         depth       = v_new_parent.depth + 1,
         layer_index = v_new_parent.layer_index + 1,
         updated_at  = NOW()
   WHERE id = p_node_id;

  -- Step 11. Recursive descendant depth + layer_index update (M-021 logic preserved).
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

  -- Step 12. Return.
  RETURN jsonb_build_object(
    'node',             (SELECT row_to_json(n) FROM nodes n WHERE n.id = p_node_id),
    'renumbered_count', v_renumbered
  );
END;
$$;

REVOKE ALL ON FUNCTION move_node(UUID, UUID, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION move_node(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION move_node(UUID, UUID, INTEGER) TO service_role;

COMMENT ON FUNCTION move_node(UUID, UUID, INTEGER) IS
  'Atomically moves a node. Per-node lock semantics per Phase 6 D2: checks moved node + immediate old parent + immediate new parent only. NO ancestor walks. M-021 cascade behaviour replaced.';
