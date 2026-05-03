-- Migration 018 — Fix create_document_with_layer_stack FK ordering
-- The original function inserted documents first (with layer_stack_id = v_stack_id),
-- but v_stack_id did not yet exist in layer_stacks, causing FK violation 23503.
-- layer_stacks.document_id is nullable, so the correct order is:
--   1. Insert layer_stacks (document_id = NULL initially)
--   2. Insert documents    (layer_stack_id FK now satisfied)
--   3. UPDATE layer_stacks SET document_id = v_doc_id

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
  v_doc_id    UUID := gen_random_uuid();
  v_stack_id  UUID := gen_random_uuid();
  v_template  layer_stacks%ROWTYPE;
  v_caller    UUID := auth.uid();
BEGIN
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

  -- Insert layer_stacks first (document_id deferred until documents row exists).
  -- layer_stacks.document_id is nullable so this is valid.
  INSERT INTO layer_stacks (
    id, document_id, organisation_id, name, document_type, is_template, layers
  )
  VALUES (
    v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers
  );

  -- Insert document now that layer_stack_id FK target (v_stack_id) exists.
  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings
  )
  VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb
  );

  -- Back-fill document_id now that the documents row exists.
  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  RETURN jsonb_build_object(
    'document',    (SELECT row_to_json(d) FROM documents d WHERE d.id = v_doc_id),
    'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
