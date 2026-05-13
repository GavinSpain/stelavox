-- Migration 077 — V1.x-A bug fix: deferrable brief_id FK + RPC order.
-- Source: Discovered during V1.x-A §3.7 testing — Migration 074's RPC
-- inserted documents BEFORE briefs, but Migration 073 had already set
-- documents.brief_id NOT NULL. Result: the RPC failed with
-- "null value in column brief_id of relation documents violates not-null
-- constraint" on every fresh document creation.
--
-- Two changes:
--   1. Make the FK on documents.brief_id DEFERRABLE INITIALLY DEFERRED.
--      This lets a transaction insert documents and briefs in any
--      order — the cross-table FK is checked at commit, not at each
--      INSERT statement.
--   2. Rewrite create_document_with_layer_stack to:
--        a. Generate UUIDs for document, layer_stack, root_node, brief
--           up front.
--        b. Insert layer_stack (no FK to either document or brief).
--        c. Insert documents row WITH brief_id = v_brief_id. The FK
--           to briefs is deferred — Postgres won't complain yet.
--        d. Insert briefs row WITH document_id = v_doc_id. The FK
--           to documents is immediate (briefs.document_id FK is NOT
--           deferred); the row exists, so the FK passes.
--        e. Back-fill layer_stacks.document_id, insert root node,
--           back-fill documents.root_node_id (existing M-074 steps).
--        f. COMMIT — Postgres validates the deferred documents.brief_id
--           FK against briefs; the brief exists, FK passes.
--
-- documents.brief_id stays NOT NULL — the invariant "every document
-- has a Brief" remains intact at the schema level.

-- 1. Drop and re-add the FK as DEFERRABLE.
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_brief_id_fk;
ALTER TABLE documents
  ADD CONSTRAINT documents_brief_id_fk
  FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE RESTRICT
  DEFERRABLE INITIALLY DEFERRED;

-- 2. Rewrite the RPC with the correct insert ordering.
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
  v_brief_id    UUID := gen_random_uuid();
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
  WHERE is_template = TRUE
    AND document_type = p_document_type
    AND organisation_id IS NULL
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
  INSERT INTO layer_stacks (
    id, document_id, organisation_id, name, document_type, is_template, layers
  )
  VALUES (
    v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers
  );

  -- Step 2: documents row WITH brief_id set. The brief itself doesn't
  -- exist yet, but documents.brief_id FK is DEFERRABLE INITIALLY DEFERRED
  -- (Migration 077) — the FK is checked at COMMIT, not here.
  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings, brief_id
  )
  VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb, v_brief_id
  );

  -- Step 3: insert the brief now that documents row exists. The
  -- briefs.document_id FK is IMMEDIATE and is satisfied.
  INSERT INTO briefs (
    id, document_id, organisation_id, status, preferences
  )
  VALUES (
    v_brief_id, v_doc_id, p_organisation_id, 'active', '{}'::jsonb
  );

  -- Step 4: back-fill layer_stacks.document_id.
  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  -- Step 5: insert root node.
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

  -- Step 6: back-fill documents.root_node_id.
  UPDATE documents SET root_node_id = v_root_id WHERE id = v_doc_id;

  -- COMMIT happens implicitly when the function returns. At that point
  -- Postgres validates the deferred documents.brief_id FK; the brief
  -- exists (Step 3), so the constraint passes.

  RETURN jsonb_build_object(
    'document',    (SELECT row_to_json(d) FROM documents d    WHERE d.id = v_doc_id),
    'layer_stack', (SELECT row_to_json(l) FROM layer_stacks l WHERE l.id = v_stack_id),
    'root_node',   (SELECT row_to_json(n) FROM nodes n        WHERE n.id = v_root_id),
    'brief',       (SELECT row_to_json(b) FROM briefs b       WHERE b.id = v_brief_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION create_document_with_layer_stack(UUID, UUID, TEXT, TEXT, TEXT, TEXT[]) TO service_role;
