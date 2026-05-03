-- Migration 019 — Allow service_role to call create_document_with_layer_stack
-- The function's membership check uses auth.uid() which returns NULL for
-- service_role (admin) callers.  Tests use adminClient() (service_role) for
-- fixture setup.  Two changes:
--   (a) Skip the membership check when v_caller IS NULL (service_role bypasses
--       auth entirely and already has full DB access via superuser grants).
--   (b) GRANT EXECUTE to service_role so the RPC can be invoked via the admin
--       client at all.
-- The project FK check is also skipped for NULL caller for the same reason.
-- Security: the service_role already bypasses RLS and has insert access on all
-- tables, so this adds no new privilege.

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
  -- Membership and project checks are only enforced for authenticated users.
  -- Service-role callers (auth.uid() IS NULL) already have full DB access.
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
  WHERE is_template = TRUE
    AND document_type = p_document_type
    AND organisation_id IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'missing_template: no system template for document_type %', p_document_type
      USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO layer_stacks (
    id, document_id, organisation_id, name, document_type, is_template, layers
  )
  VALUES (
    v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers
  );

  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings
  )
  VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb
  );

  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  RETURN jsonb_build_object(
    'document',    (SELECT row_to_json(d) FROM documents d WHERE d.id = v_doc_id),
    'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
