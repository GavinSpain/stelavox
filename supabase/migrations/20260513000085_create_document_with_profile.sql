-- Migration 085 — V1.x-A.1: extend create_document_with_layer_stack for Project Profile.
-- Source: stelavox_director_architecture_v2_1_0.md §6.1.1 (auto-create).
--
-- Each new document gets exactly one Project Profile, atomically. Same
-- deferrable-FK pattern as the V1.x-A M-077 fix: insert documents row
-- with profile_id set (FK deferred), insert project_profiles row (FK
-- to documents satisfied immediately), commit validates the deferred FK.

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
  v_profile_id  UUID := gen_random_uuid();
  v_template    layer_stacks%ROWTYPE;
  v_caller      UUID := auth.uid();
  v_root_type   TEXT;
BEGIN
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

  SELECT * INTO v_template
  FROM layer_stacks
  WHERE is_template = TRUE AND document_type = p_document_type AND organisation_id IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_template: no system template for document_type %', p_document_type
      USING ERRCODE = 'no_data_found';
  END IF;

  v_root_type := v_template.layers->0->>'node_type';
  IF v_root_type IS NULL OR v_root_type = '' THEN
    RAISE EXCEPTION 'missing_template: layer_stacks template % has empty layer 0 node_type', v_template.id
      USING ERRCODE = 'data_exception';
  END IF;

  -- Step 1: layer_stacks first (H-14).
  INSERT INTO layer_stacks (id, document_id, organisation_id, name, document_type, is_template, layers)
  VALUES (v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers);

  -- Step 2: documents WITH profile_id set. FK is DEFERRABLE INITIALLY
  -- DEFERRED (M-084) — Postgres checks it at COMMIT, not here.
  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings, profile_id
  ) VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb, v_profile_id
  );

  -- Step 3: project_profiles row. FK to documents is IMMEDIATE; the
  -- documents row exists (Step 2), so the constraint passes.
  INSERT INTO project_profiles (id, document_id, organisation_id, preferences)
  VALUES (v_profile_id, v_doc_id, p_organisation_id, '{}'::jsonb);

  -- Step 4: back-fill layer_stacks.document_id.
  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  -- Step 5: root node.
  INSERT INTO nodes (
    id, organisation_id, document_id, project_id,
    node_category, node_type, parent_id, "order", depth, layer_index,
    name, status, version
  ) VALUES (
    v_root_id, p_organisation_id, v_doc_id, p_project_id,
    'structural', v_root_type, NULL, 1, 0, 0,
    p_name, 'draft', 1
  );

  -- Step 6: back-fill documents.root_node_id.
  UPDATE documents SET root_node_id = v_root_id WHERE id = v_doc_id;

  -- COMMIT validates the deferred documents.profile_id FK; project_profiles
  -- row exists (Step 3), so the constraint passes.

  RETURN jsonb_build_object(
    'document',         (SELECT row_to_json(d) FROM documents d         WHERE d.id = v_doc_id),
    'layer_stack',      (SELECT row_to_json(l) FROM layer_stacks l      WHERE l.id = v_stack_id),
    'root_node',        (SELECT row_to_json(n) FROM nodes n             WHERE n.id = v_root_id),
    'project_profile',  (SELECT row_to_json(p) FROM project_profiles p  WHERE p.id = v_profile_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
