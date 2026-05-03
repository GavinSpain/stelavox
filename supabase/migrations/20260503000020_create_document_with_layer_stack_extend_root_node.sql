-- Migration 020 — Extend create_document_with_layer_stack to insert root node
-- Phase 2 task T-1.1
-- Spec: stelavox_phase2_api_contract_v1_0.md §1.4 / §3.7
--
-- Extends the Phase 1 RPC so that a fresh document gets:
--   (a) the documents row              (Migration 015)
--   (b) a forked layer_stacks row      (Migration 015 + 018 ordering fix)
--   (c) a root node in `nodes`         (NEW in this migration)
--   (d) documents.root_node_id back-filled to (c)'s id (NEW)
-- All in a single PL/pgSQL function (one transaction).
--
-- The root node's properties come from layer_stacks.layers[0]:
--   - node_type = layers[0]->>'node_type' (e.g. 'book' for novel, 'story' for
--     short_story, 'series' for series)
--   - layer_index = 0
--   - depth = 0
--   - parent_id = NULL
--   - order = 1
--   - node_category = 'structural'
--   - name = p_name (the document's name; user can rename via PATCH)
--   - status = 'draft'
--
-- All Migration 015–019 corrections preserved verbatim:
--   - SECURITY DEFINER + SET search_path = public  (Migration 017, H-13)
--   - Insert layer_stacks first with NULL document_id, then documents,
--     then UPDATE layer_stacks.document_id  (Migration 018, H-14)
--   - Service-role bypass: skip membership/project checks when v_caller IS NULL
--     (Migration 019)
--   - GRANT EXECUTE TO authenticated AND service_role  (Migration 019)
--
-- Atomicity: a failure at any step (including the new node insert or the
-- UPDATE on documents.root_node_id) rolls back the entire transaction —
-- no partial state is observable. TC-A-100 verifies this.

CREATE OR REPLACE FUNCTION create_document_with_layer_stack(
  p_project_id      UUID,
  p_organisation_id UUID,
  p_name            TEXT,
  p_description     TEXT,
  p_document_type   TEXT,
  p_authors         TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doc_id      UUID := gen_random_uuid();
  v_stack_id    UUID := gen_random_uuid();
  v_root_id     UUID := gen_random_uuid();
  v_template    layer_stacks%ROWTYPE;
  v_caller      UUID := auth.uid();
  v_root_type   TEXT;
BEGIN
  -- Membership and project checks are only enforced for authenticated callers.
  -- service_role (auth.uid() IS NULL) already bypasses RLS at the table layer.
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = p_organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', p_organisation_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM projects WHERE id = p_project_id AND organisation_id = p_organisation_id
    ) THEN
      RAISE EXCEPTION 'project not found or not in organisation %', p_organisation_id
        USING ERRCODE = 'no_data_found';
    END IF;
  END IF;

  -- Look up the system layer-stack template for this document_type.
  SELECT * INTO v_template
  FROM layer_stacks
  WHERE is_template = TRUE
    AND document_type = p_document_type
    AND organisation_id IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_template: no system template for document_type %', p_document_type
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Resolve the root node's type from the template's first layer.
  -- The seed guarantees layers is a non-empty JSONB array.
  v_root_type := v_template.layers->0->>'node_type';

  IF v_root_type IS NULL OR v_root_type = '' THEN
    RAISE EXCEPTION 'missing_template: layer_stacks template % has empty layer 0 node_type', v_template.id
      USING ERRCODE = 'data_exception';
  END IF;

  -- Step 1: Insert layer_stacks first with document_id = NULL (nullable).
  -- See H-14 (documents ↔ layer_stacks insert ordering).
  INSERT INTO layer_stacks (
    id, document_id, organisation_id, name, document_type, is_template, layers
  )
  VALUES (
    v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers
  );

  -- Step 2: Insert document. Its layer_stack_id FK is now satisfied.
  -- root_node_id is left NULL here and back-filled in step 5 once the root node row exists.
  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings
  )
  VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb
  );

  -- Step 3: Back-fill layer_stacks.document_id (existing Phase 1 step).
  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  -- Step 4: Insert the root node. Phase 2 invariant: every document has
  -- exactly one node with parent_id IS NULL, and documents.root_node_id
  -- points at it. Status defaults to 'draft'; the user can rename / change
  -- status via PATCH /api/nodes/[id].
  INSERT INTO nodes (
    id, organisation_id, document_id, project_id,
    node_category, node_type, parent_id, "order", depth, layer_index,
    name, status, version
  )
  VALUES (
    v_root_id, p_organisation_id, v_doc_id, p_project_id,
    'structural', v_root_type, NULL, 1, 0, 0,
    p_name, 'draft', 1
  );

  -- Step 5: Back-fill documents.root_node_id. Atomic with everything above.
  UPDATE documents SET root_node_id = v_root_id WHERE id = v_doc_id;

  RETURN jsonb_build_object(
    'document',    (SELECT row_to_json(d) FROM documents d    WHERE d.id = v_doc_id),
    'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id),
    'root_node',   (SELECT row_to_json(n) FROM nodes n        WHERE n.id = v_root_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
