-- Migration 098 — V1.x-B.1.1: accept_brief revised + accept_agent_job extended.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.8
--         + design record §10 (sequential multi-Brief).
--
-- Two changes:
--   1. accept_brief — when an active Brief exists for the document,
--      land the new Brief as 'queued' with sequence_position = MAX+1.
--      When no active Brief exists, land directly as 'active' with
--      sequence_position 0.
--
--   2. accept_agent_job — at the existing acceptance commit point,
--      if the accepted job's workflow_step is the last incomplete step
--      in its workflow, call complete_brief_stage_workflow(workflow_id).
--      This closes the V1.x-A.1 carry-over gap (workflow_complete →
--      stage_complete → brief_complete propagation never wired).

-- ---------------------------------------------------------------------------
-- 1. accept_brief — queue when active exists; else activate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accept_brief(
  p_document_id UUID,
  p_goal_text   TEXT,
  p_stages      JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_doc             documents%ROWTYPE;
  v_brief_id        UUID := gen_random_uuid();
  v_first_stage_id  UUID;
  v_stage           JSONB;
  v_active_exists   BOOLEAN;
  v_initial_status  TEXT;
  v_seq_position    INTEGER;
BEGIN
  SELECT * INTO v_doc FROM documents WHERE id = p_document_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'document_not_found: %', p_document_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_doc.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of document organisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF jsonb_typeof(p_stages) <> 'array' OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'invalid_stages: expected non-empty JSONB array'
      USING ERRCODE = 'data_exception';
  END IF;

  IF p_goal_text IS NULL OR length(trim(p_goal_text)) = 0 THEN
    RAISE EXCEPTION 'invalid_goal_text: required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- V1.x-B.1.1 logic: queue if active exists, else activate.
  SELECT EXISTS (
    SELECT 1 FROM briefs
    WHERE document_id = p_document_id AND status = 'active'
  ) INTO v_active_exists;

  IF v_active_exists THEN
    v_initial_status := 'queued';
    SELECT COALESCE(MAX(sequence_position), 0) + 1 INTO v_seq_position
    FROM briefs
    WHERE document_id = p_document_id AND status IN ('queued','planned');
  ELSE
    v_initial_status := 'active';
    v_seq_position := 0;
  END IF;

  INSERT INTO briefs (
    id, document_id, organisation_id, goal_text, status,
    sequence_position, cause,
    approved_at, started_at
  ) VALUES (
    v_brief_id, p_document_id, v_doc.organisation_id, p_goal_text, v_initial_status,
    v_seq_position, 'user_initial',
    NOW(),
    CASE WHEN v_initial_status = 'active' THEN NOW() ELSE NULL END
  );

  FOR v_stage IN SELECT jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO brief_stages (
      brief_id, "order", title, description, trigger_type, trigger_config, status
    ) VALUES (
      v_brief_id,
      (v_stage->>'order')::INTEGER,
      v_stage->>'title',
      v_stage->>'description',
      v_stage->>'trigger_type',
      COALESCE(v_stage->'trigger_config', '{}'::jsonb),
      'planned'
    );
  END LOOP;

  -- current_stage_id is set only when the Brief is active.
  IF v_initial_status = 'active' THEN
    SELECT id INTO v_first_stage_id
    FROM brief_stages WHERE brief_id = v_brief_id ORDER BY "order" ASC LIMIT 1;

    UPDATE briefs SET current_stage_id = v_first_stage_id WHERE id = v_brief_id;
  END IF;

  RETURN jsonb_build_object(
    'brief',           (SELECT row_to_json(b) FROM briefs b WHERE b.id = v_brief_id),
    'stages',          (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order") FROM brief_stages s WHERE s.brief_id = v_brief_id),
    'initial_status',  v_initial_status,
    'queue_position',  v_seq_position
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_brief(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. accept_agent_job extended — propagate workflow completion.
-- ---------------------------------------------------------------------------
-- Adds Brief lifecycle propagation at the existing acceptance commit
-- point. Logic:
--   1. After the agent_jobs UPDATE to 'accepted', find the
--      workflow_step linked via agent_job_id.
--   2. If found and the step isn't already terminal, mark it
--      'completed'.
--   3. Count remaining incomplete steps in the workflow.
--   4. If zero, mark workflow 'completed' and call
--      complete_brief_stage_workflow(workflow_id) — which propagates
--      through the Brief lifecycle.
--
-- Idempotent: re-accepting an already-accepted job (the early-return
-- path at the top) skips the propagation block.
--
-- All existing M-090 behaviour preserved verbatim — only the
-- propagation block at the end is new.

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
  v_step RECORD;
  v_remaining_steps INTEGER;
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

  IF v_job.target_node_version_at_capture IS NOT NULL
     AND v_node.version != v_job.target_node_version_at_capture THEN
    RAISE EXCEPTION 'target_version_mismatch:%:%',
      v_node.version, v_job.target_node_version_at_capture USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO node_versions (
    node_id, organisation_id, version,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_node.version,
    v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
    p_actor_id, 'agent_' || v_job.operation_type
  );

  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context') THEN
    PERFORM set_config('stelavox.bump_version', 'true', true);
    UPDATE nodes SET
      summary = COALESCE(p_target_summary::JSONB, summary),
      prose = COALESCE(p_target_prose::JSONB, prose),
      notes = COALESCE(p_target_notes::JSONB, notes),
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
        status, version
      ) VALUES (
        v_node.organisation_id, v_node.project_id, v_node.document_id, v_node.id,
        'structural', v_child_node_type,
        v_node.layer_index + 1, COALESCE(v_node.depth, 0) + 1, v_max_position,
        v_child->>'name',
        v_child->>'short_description',
        v_child->'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  UPDATE agent_jobs SET
    status = 'accepted',
    completed_at = NOW()
  WHERE id = p_job_id;

  -- ============================================================
  -- V1.x-B.1.1 NEW: Brief lifecycle propagation.
  -- ============================================================
  -- Find the workflow_step linked to this agent_job. If found, mark
  -- the step completed (idempotent), then check whether this was the
  -- last incomplete step in its workflow. If yes, mark the workflow
  -- completed and call complete_brief_stage_workflow to propagate
  -- through the Brief lifecycle (stage → brief → queue promotion).

  SELECT * INTO v_step
  FROM workflow_steps
  WHERE agent_job_id = p_job_id
  LIMIT 1;

  IF FOUND THEN
    IF v_step.status NOT IN ('completed','skipped','removed') THEN
      UPDATE workflow_steps
      SET status = 'completed', completed_at = NOW()
      WHERE id = v_step.id;
    END IF;

    SELECT COUNT(*) INTO v_remaining_steps
    FROM workflow_steps
    WHERE workflow_id = v_step.workflow_id
      AND status NOT IN ('completed','skipped','removed');

    IF v_remaining_steps = 0 THEN
      UPDATE workflows
      SET status = 'completed', completed_at = NOW(), updated_at = NOW()
      WHERE id = v_step.workflow_id AND status NOT IN ('completed','cancelled');

      PERFORM complete_brief_stage_workflow(v_step.workflow_id);
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_node.id,
    (SELECT version FROM nodes WHERE id = v_node.id),
    v_new_child_ids;
END;
$$;
