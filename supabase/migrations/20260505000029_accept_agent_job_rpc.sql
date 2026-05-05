-- Migration 029 — accept_agent_job() stored procedure
-- Source: stelavox_phase5_api_contract_v1_0.md v1.2 §3.7 (Accept transactional path)
-- Build Checklist: T-9.3
--
-- Atomically applies a `completed` agent_jobs row to the target node:
--   1. Locks the target node (FOR UPDATE) and verifies version match
--      against agent_jobs.target_node_version_at_capture (G-3 concurrency
--      gate). On mismatch raises target_version_mismatch.
--   2. Inserts a node_versions row capturing the pre-agent state (with
--      change_reason = 'agent_<operation>').
--   3. For refine/synthesise/generate_context: UPDATEs nodes with the
--      Tiptap-JSON-stringified summary/prose/notes and (for
--      generate_context) merges proposed metadata into the existing object.
--      The Migration 023 trigger auto-bumps nodes.version on UPDATE.
--   4. For expand: INSERTs each proposed child node under the target
--      with auto-incremented position appended after existing children.
--      Resolves child node_type from the document's layer_stack.
--   5. UPDATEs agent_jobs.status='accepted' + completed_at.
--
-- The Tiptap JSON conversion (plainTextToTiptap) happens in TypeScript
-- before this procedure is called — the API route passes already-
-- stringified Tiptap JSON. This keeps the conversion in code (where it
-- belongs) and the DB operations atomic.
--
-- Idempotent on already-accepted jobs: returns the existing committed
-- state without writing.
--
-- Errors raised (caller catches and translates to HTTP):
--   agent_job_not_found       → 404
--   agent_job_already_terminal → 409
--   target_version_mismatch   → 409
--   target_node_not_found     → 500 (job has node_id but node missing)
--   no_child_layer            → 500 (target is unexpectedly leaf for expand)

CREATE OR REPLACE FUNCTION accept_agent_job(
  p_job_id UUID,
  p_actor_id TEXT,
  p_target_summary TEXT DEFAULT NULL,    -- Pre-stringified Tiptap JSON
  p_target_prose TEXT DEFAULT NULL,
  p_target_notes TEXT DEFAULT NULL,
  p_target_metadata JSONB DEFAULT NULL,
  p_child_nodes JSONB DEFAULT NULL       -- Array of { name, short_description, summary (Tiptap JSON string), metadata, word_count_target }
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
  -- 1. Lock job, verify state
  SELECT * INTO v_job FROM agent_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job IS NULL THEN
    RAISE EXCEPTION 'agent_job_not_found' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent on already-accepted: return current state
  IF v_job.status = 'accepted' THEN
    RETURN QUERY SELECT v_job.node_id, NULL::INTEGER, ARRAY[]::UUID[];
    RETURN;
  END IF;

  IF v_job.status != 'completed' THEN
    RAISE EXCEPTION 'agent_job_already_terminal:%', v_job.status USING ERRCODE = 'P0001';
  END IF;

  -- 2. Lock target node, verify version
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

  -- 3. Snapshot pre-agent state into node_versions
  INSERT INTO node_versions (
    node_id, organisation_id, version,
    summary, prose, notes, metadata,
    changed_by, change_reason
  ) VALUES (
    v_node.id, v_node.organisation_id, v_node.version,
    v_node.summary, v_node.prose, v_node.notes, v_node.metadata,
    p_actor_id, 'agent_' || v_job.operation_type
  );

  -- 4. Apply per-operation result writes
  IF v_job.operation_type IN ('synthesise', 'refine', 'generate_context') THEN
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
    -- Migration 023 trigger auto-bumps nodes.version on UPDATE
  END IF;

  IF v_job.operation_type = 'expand' AND p_child_nodes IS NOT NULL THEN
    -- Resolve child node_type from layer stack at (target.layer_index + 1)
    SELECT layer_stack_id INTO v_layer_stack_id
    FROM documents WHERE id = v_node.document_id;

    SELECT layers->((v_node.layer_index + 1)::INT)->>'node_type'
    INTO v_child_node_type
    FROM layer_stacks WHERE id = v_layer_stack_id;

    IF v_child_node_type IS NULL THEN
      RAISE EXCEPTION 'no_child_layer' USING ERRCODE = 'P0001';
    END IF;

    -- Append after existing children. Per Phase 2's nodes."order" convention
    -- (1-indexed; reserved keyword hence quoted), the agent emits position
    -- 0,1,2,... but we translate to "order" 1,2,3,... before INSERT.
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
        v_child->>'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  -- 5. Mark job accepted
  UPDATE agent_jobs SET
    status = 'accepted',
    completed_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT
    v_node.id,
    (SELECT version FROM nodes WHERE id = v_node.id),
    v_new_child_ids;
END;
$$;
