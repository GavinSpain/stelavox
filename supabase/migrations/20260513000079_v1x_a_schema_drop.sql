-- Migration 079 — V1.x-A.1: rip V1.x-A schema for architectural rework.
-- Source: stelavox_director_architecture_v2_1_0.md §6 + v1x-a1 build checklist §3.1 T-1.1.
--
-- V1.x-A merged the conflated `briefs` table with both project-level
-- identity AND operation-level multi-stage plans. V1.x-A.1 separates
-- them into project_profiles + briefs (operation-level). This migration
-- rips out the V1.x-A objects; subsequent migrations 080-088 build the
-- V1.x-A.1 schema.
--
-- Data preservation: the only data is the Shadow Protocol test project
-- on local dev. Its V1.x-A `briefs` row is empty (goal_text NULL, no
-- preferences, no stages, no amendments) — semantically equivalent to
-- "no Brief". Dropping the row loses nothing. The document and node
-- tree are preserved.
--
-- Order matters: drop dependents before parents.
--   1. Drop documents.brief_id FK + column (was a deferrable FK to briefs).
--   2. Drop brief_amendments (FK to briefs).
--   3. Drop brief_stages (FK to briefs).
--   4. Drop briefs.
--   5. Drop the SECURITY DEFINER RPCs from M-075/M-078.
--   6. Remove briefs + brief_stages from supabase_realtime publication.
--   7. Restore create_document_with_layer_stack to its pre-M-074 form
--      (no Brief insertion). M-085 will re-extend it for Project Profile.

BEGIN;

-- 1. documents.brief_id
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_brief_id_fk;
DROP INDEX IF EXISTS documents_brief_id_unique;
ALTER TABLE documents DROP COLUMN IF EXISTS brief_id;

-- 2-4. tables (CASCADE to drop the inter-table FK from briefs.current_stage_id)
DROP TABLE IF EXISTS brief_amendments CASCADE;
DROP TABLE IF EXISTS brief_stages CASCADE;
DROP TABLE IF EXISTS briefs CASCADE;

-- 5. RPCs from M-075 / M-078
DROP FUNCTION IF EXISTS apply_brief_proposal(UUID, TEXT, JSONB, JSONB);
DROP FUNCTION IF EXISTS apply_brief_amendment(UUID, TEXT, TEXT, JSONB, TEXT);

-- 6. realtime publication — briefs + brief_stages are gone after CASCADE drops above.
-- The publication-membership rows were removed automatically when the tables dropped.
-- (Postgres doesn't support `ALTER PUBLICATION ... DROP TABLE IF EXISTS`.)

-- 7. restore create_document_with_layer_stack to a Brief-free form.
-- Same body as M-020 (the pre-M-074 / pre-M-077 form). M-085 will
-- re-extend it for project_profiles.
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

  INSERT INTO layer_stacks (id, document_id, organisation_id, name, document_type, is_template, layers)
  VALUES (v_stack_id, NULL, p_organisation_id, v_template.name, p_document_type, FALSE, v_template.layers);

  INSERT INTO documents (
    id, organisation_id, project_id, name, description, document_type,
    layer_stack_id, status, authors, export_settings
  ) VALUES (
    v_doc_id, p_organisation_id, p_project_id, p_name, p_description, p_document_type,
    v_stack_id, 'active', COALESCE(p_authors, '{}'::TEXT[]), '{}'::jsonb
  );

  UPDATE layer_stacks SET document_id = v_doc_id WHERE id = v_stack_id;

  INSERT INTO nodes (
    id, organisation_id, document_id, project_id,
    node_category, node_type, parent_id, "order", depth, layer_index,
    name, status, version
  ) VALUES (
    v_root_id, p_organisation_id, v_doc_id, p_project_id,
    'structural', v_root_type, NULL, 1, 0, 0,
    p_name, 'draft', 1
  );

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

COMMIT;
