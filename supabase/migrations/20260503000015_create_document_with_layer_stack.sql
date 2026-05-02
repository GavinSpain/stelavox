-- Migration 013 — Atomic document + layer-stack creation RPC
-- Build Checklist: T-7.7
-- Phase 1 deliverable. Flagged for absorption into Technical Architecture v1.4
-- via SU-2.
--
-- Two-insert atomicity rationale: documents.layer_stack_id references the
-- forked layer_stacks row, and layer_stacks.document_id references the new
-- document. The pair must commit together. This RPC wraps both inserts in a
-- single statement (one PL/pgSQL function = one implicit transaction).
--
-- The template (`is_template = TRUE`, `organisation_id IS NULL`) is read inside
-- the function. Because RLS on layer_stacks excludes that row from user-session
-- reads, this function is declared SECURITY DEFINER for the template lookup.
-- All other operations operate on the user's own organisation, so the function
-- still verifies organisation membership at entry.

CREATE OR REPLACE FUNCTION create_document_with_layer_stack(
  p_project_id      UUID,
  p_organisation_id UUID,
  p_name            TEXT,
  p_description     TEXT,
  p_document_type   TEXT,
  p_authors         TEXT[]
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_doc_id    UUID := gen_random_uuid();
  v_stack_id  UUID := gen_random_uuid();
  v_template  layer_stacks%ROWTYPE;
  v_caller    UUID := auth.uid();
BEGIN
  -- Belt-and-braces membership check. The API route also enforces this via
  -- RLS on the projects lookup, but defence in depth: this function is
  -- SECURITY DEFINER so we cannot rely on RLS inside it.
  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
    WHERE user_id = v_caller AND organisation_id = p_organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', p_organisation_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify project belongs to the claimed organisation.
  IF NOT EXISTS (
    SELECT 1 FROM projects WHERE id = p_project_id AND organisation_id = p_organisation_id
  ) THEN
    RAISE EXCEPTION 'project not found or not in organisation %', p_organisation_id
      USING ERRCODE = 'no_data_found';
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

  -- Insert the document first so layer_stacks.document_id has something to FK to.
  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings
  )
  VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb
  );

  -- Fork the template into a new per-document layer_stacks row.
  INSERT INTO layer_stacks (
    id, document_id, organisation_id, name, document_type, is_template, layers
  )
  VALUES (
    v_stack_id, v_doc_id, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers
  );

  RETURN jsonb_build_object(
    'document',    (SELECT row_to_json(d) FROM documents d WHERE d.id = v_doc_id),
    'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id)
  );
END;
$$;

-- Lock down execution. Authenticated users may call; the function performs
-- explicit membership checks before doing any work.
REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
