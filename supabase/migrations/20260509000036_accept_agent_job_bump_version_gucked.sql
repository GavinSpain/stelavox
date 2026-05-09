-- Migration 036 — accept_agent_job opts into version bump for content-modifying ops
-- Source: SU-J14-1 (docs/stelavox_phase5d_su_j14_1_version_semantics.md)
--
-- Migration 035 split content_revision (autosave anchor) from version
-- (semantic checkpoint). version now only bumps when the caller sets the
-- session GUC stelavox.bump_version = 'true' before the UPDATE.
--
-- accept_agent_job() now:
--   - For synthesise / refine / generate_context: sets stelavox.bump_version=true
--     before the UPDATE, then resets it to false. The trigger sees the GUC and
--     bumps both content_revision and version.
--   - For expand: no UPDATE on the target, only INSERT children. Neither field
--     bumps on the target. (The new child rows get version=1, content_revision=1.)
--
-- Also writes the snapshot's content_revision into node_versions for traceability.

CREATE OR REPLACE FUNCTION accept_agent_job(
  p_job_id UUID,
  p_actor_id TEXT,
  p_target_summary TEXT DEFAULT NULL,
  p_target_prose TEXT DEFAULT NULL,
  p_target_notes TEXT DEFAULT NULL,
  p_target_metadata JSONB DEFAULT NULL,
  p_child_nodes JSONB DEFAULT NULL
)
RETURNS TABLE (
  out_node_id UUID,
  out_new_version INTEGER,
  out_child_node_ids UUID[]
)
SECURITY DEFINER SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_job RECORD;
  v_node RECORD;
  v_new_child_ids UUID[] := ARRAY[]::UUID[];
  v_child JSONB;
  v_max_position INTEGER;
  v_new_node_id UUID;
  v_child_node_type TEXT;
  v_layer_stack_id UUID;
BEGIN
  SELECT * INTO v_job FROM agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'agent_job_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.status = 'accepted' THEN
    RETURN QUERY SELECT v_job.node_id, NULL::INTEGER, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF v_job.status != 'completed' THEN
    RAISE EXCEPTION 'agent_job_already_terminal:%', v_job.status USING ERRCODE = 'P0001';
  END IF;

  IF v_job.node_id IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_node FROM nodes WHERE id = v_job.node_id FOR UPDATE;
  IF v_node IS NULL THEN
    RAISE EXCEPTION 'target_node_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context')
     AND v_job.target_node_version_at_capture IS NOT NULL
     AND v_node.version != v_job.target_node_version_at_capture THEN
    RAISE EXCEPTION 'target_version_mismatch:%:%',
      v_node.version, v_job.target_node_version_at_capture USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO node_versions (
    node_id, organisation_id, version, content_revision,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_node.version, v_node.content_revision,
    v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
    p_actor_id, 'agent_' || v_job.operation_type
  );

  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context') THEN
    PERFORM set_config('stelavox.bump_version', 'true', true);
    UPDATE nodes SET
      summary = COALESCE(p_target_summary, summary),
      prose = COALESCE(p_target_prose, prose),
      notes = COALESCE(p_target_notes, notes),
      metadata = CASE
        WHEN p_target_metadata IS NOT NULL
        THEN COALESCE(metadata, '{}'::jsonb) || p_target_metadata
        ELSE metadata
      END
    WHERE id = v_node.id;
    PERFORM set_config('stelavox.bump_version', 'false', true);
  END IF;

  IF v_job.operation_type = 'expand' AND p_child_nodes IS NOT NULL THEN
    SELECT layer_stack_id INTO v_layer_stack_id
    FROM documents WHERE id = v_node.document_id;

    SELECT layers->((v_node.layer_index + 1)::INT)->>'node_type'
    INTO v_child_node_type
    FROM layer_stacks WHERE id = v_layer_stack_id;

    IF v_child_node_type IS NULL THEN
      RAISE EXCEPTION 'no_child_layer' USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(MAX("order"), 0) INTO v_max_position
    FROM nodes WHERE parent_id = v_node.id;

    FOR v_child IN SELECT * FROM jsonb_array_elements(p_child_nodes)
    LOOP
      v_max_position := v_max_position + 1;
      INSERT INTO nodes (
        organisation_id, project_id, document_id, parent_id,
        node_category, node_type,
        layer_index, depth, "order",
        name, short_description, summary,
        metadata, word_count_target,
        status, version, content_revision
      ) VALUES (
        v_node.organisation_id, v_node.project_id, v_node.document_id, v_node.id,
        'structural', v_child_node_type,
        v_node.layer_index + 1, COALESCE(v_node.depth, 0) + 1, v_max_position,
        v_child->>'name',
        v_child->>'short_description',
        v_child->>'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1, 1
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  UPDATE agent_jobs
  SET status = 'accepted', completed_at = NOW()
  WHERE id = p_job_id;

  SELECT version INTO v_node.version FROM nodes WHERE id = v_node.id;

  RETURN QUERY SELECT v_node.id, v_node.version, v_new_child_ids;
END;
$$;
