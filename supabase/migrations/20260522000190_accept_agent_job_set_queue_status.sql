-- M-190 — accept_agent_job: set queue_status alongside status.
--
-- Surfaced 2026-05-22 by user test: a stage-1 expand agent_job that had
-- completed and been accepted held its target node locked indefinitely
-- because accept_agent_job set status='accepted' + completed_at=NOW()
-- but left queue_status untouched. check_node_writable's Agent-In-Flight
-- branch fires on `OR status='completed'` AND on
-- `queue_status IN ('queued','dispatched','running')`, so any row whose
-- queue_status wasn't ALSO transitioned to a terminal value continued to
-- block writes.
--
-- This is the SQL companion to the lib/agent/job-lifecycle.ts changes
-- in the same commit that add queue_status writes to persistFinalResult
-- / persistFailure / persistCancellation. Together they close the gap
-- where workflow-step jobs (INSERTed by the workflow-executor with
-- DEFAULT queue_status='queued', then runAgentJob fired directly via
-- waitUntil without going through the dispatcher's CAS) finish their
-- work but stay forever in queue_status='queued' — which the dispatcher
-- then re-claims and resurrects.
--
-- Rewrite preserves the entire accept_agent_job body verbatim; the only
-- substantive change is the final UPDATE block now writes queue_status.
-- Backfill below sets queue_status correctly for any pre-existing rows
-- in a zombie state (status terminal but queue_status not).

CREATE OR REPLACE FUNCTION public.accept_agent_job(
  p_job_id uuid,
  p_actor_id text,
  p_target_summary text DEFAULT NULL::text,
  p_target_prose text DEFAULT NULL::text,
  p_target_notes text DEFAULT NULL::text,
  p_target_metadata jsonb DEFAULT NULL::jsonb,
  p_child_nodes jsonb DEFAULT NULL::jsonb
)
RETURNS TABLE(out_node_id uuid, out_new_version integer, out_child_node_ids uuid[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      END,
      last_ai_change_at = NOW()
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
        status, version,
        last_ai_change_at
      ) VALUES (
        v_node.organisation_id, v_node.project_id, v_node.document_id, v_node.id,
        'structural', v_child_node_type,
        v_node.layer_index + 1, COALESCE(v_node.depth, 0) + 1, v_max_position,
        v_child->>'name',
        v_child->>'short_description',
        v_child->'summary',
        COALESCE(v_child->'metadata', '{}'::jsonb),
        NULLIF((v_child->>'word_count_target')::TEXT, '')::INTEGER,
        'draft', 1,
        NOW()
      ) RETURNING id INTO v_new_node_id;
      v_new_child_ids := array_append(v_new_child_ids, v_new_node_id);
    END LOOP;
  END IF;

  -- 2026-05-22 M-190 — also write queue_status to its terminal value.
  -- Without this, the row stays in queue_status='dispatched' / 'queued'
  -- after accept, and check_node_writable continues to flag the target
  -- node as in-progress for as long as the row exists.
  UPDATE agent_jobs SET
    status = 'accepted',
    queue_status = 'completed',
    completed_at = NOW()
  WHERE id = p_job_id;

  RETURN QUERY SELECT
    v_node.id,
    (SELECT version FROM nodes WHERE id = v_node.id),
    v_new_child_ids;
END;
$function$;

-- ---------------------------------------------------------------------------
-- Backfill — bring any pre-existing zombie rows to the canonical terminal
-- state. The full mapping per M-106:
--   status='completed' / 'accepted'  → queue_status='completed'
--   status='failed'                  → queue_status='failed'
--   status='cancelled'               → queue_status='cancelled'
--
-- Only touch rows whose queue_status is currently in a NON-terminal value
-- (queued / dispatched / running) AND completed_at IS NOT NULL. Skips
-- the steady-state rows whose queue_status already matches.
-- ---------------------------------------------------------------------------

UPDATE agent_jobs
SET queue_status = CASE
  WHEN status IN ('completed','accepted') THEN 'completed'
  WHEN status = 'failed'                  THEN 'failed'
  WHEN status = 'cancelled'               THEN 'cancelled'
  ELSE queue_status
END
WHERE completed_at IS NOT NULL
  AND queue_status IN ('queued','dispatched','running')
  AND status IN ('completed','accepted','failed','cancelled');
