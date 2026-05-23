-- M-200 — Apollo-grade cascade cancel + force_reset_document.
--
-- Phase 4 from the audit. The existing cancel_brief only updates
-- briefs + brief_stages; running workflows / agent_jobs / director_turns
-- continue. After this migration, cancel_brief cascades through every
-- layer in one atomic call. force_reset_document is the explicit
-- "Apollo reset button" — for admin recovery when state is stuck.
--
-- All writes go through the `state` column directly; the auto-derive
-- triggers keep legacy columns in sync. The enforce_legal_transition
-- triggers refuse any illegal transition — so even bugs in this RPC
-- can't corrupt state.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. cancel_brief — enhanced cascade
-- ---------------------------------------------------------------------------
-- Cancels: briefs → brief_stages → workflows → workflow_steps →
--          agent_jobs → director_turns → director_iteration jobs.

CREATE OR REPLACE FUNCTION public.cancel_brief(
  p_brief_id uuid,
  p_reason   text DEFAULT 'user_cancelled'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc_id          UUID;
  v_brief_state     TEXT;
  v_pending_stages  INT := 0;
  v_completed_stages INT := 0;
  v_cancelled_workflows INT := 0;
  v_cancelled_steps INT := 0;
  v_cancelled_jobs  INT := 0;
  v_cancelled_turns INT := 0;
BEGIN
  SELECT document_id, state INTO v_doc_id, v_brief_state
    FROM briefs WHERE id = p_brief_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_brief_state NOT IN ('active') THEN
    -- Already terminal; idempotent.
    RETURN jsonb_build_object('already_terminal', true, 'state', v_brief_state);
  END IF;

  -- Step 1: count stages for the cascade summary.
  SELECT COUNT(*) FILTER (WHERE state IN ('completed')),
         COUNT(*) FILTER (WHERE state IN ('planned','planning','ready'))
    INTO v_completed_stages, v_pending_stages
    FROM brief_stages WHERE brief_id = p_brief_id;

  -- Step 2: cancel non-terminal brief_stages.
  UPDATE brief_stages
     SET state = 'cancelled', completed_at = NOW()
   WHERE brief_id = p_brief_id
     AND state IN ('planned','planning','ready');

  -- Step 3: cancel non-terminal workflows tied to those stages.
  WITH affected_workflows AS (
    SELECT DISTINCT workflow_id FROM brief_stages
     WHERE brief_id = p_brief_id AND workflow_id IS NOT NULL
  )
  UPDATE workflows w
     SET state = 'cancelled', cancelled_at = NOW()
    FROM affected_workflows aw
   WHERE w.id = aw.workflow_id
     AND w.state IN ('draft','approved','running','paused');
  GET DIAGNOSTICS v_cancelled_workflows = ROW_COUNT;

  -- Step 4: skip non-terminal workflow_steps.
  WITH affected AS (
    SELECT ws.id FROM workflow_steps ws
     JOIN brief_stages bs ON bs.workflow_id = ws.workflow_id
     WHERE bs.brief_id = p_brief_id
       AND ws.state IN ('pending','running')
  )
  UPDATE workflow_steps ws
     SET state = 'skipped', completed_at = NOW()
    FROM affected WHERE ws.id = affected.id;
  GET DIAGNOSTICS v_cancelled_steps = ROW_COUNT;

  -- Step 5: cancel in-flight agent_jobs (workflow-step jobs).
  WITH affected_jobs AS (
    SELECT aj.id FROM agent_jobs aj
     JOIN workflow_steps ws ON aj.id = ws.agent_job_id
     JOIN brief_stages bs ON bs.workflow_id = ws.workflow_id
     WHERE bs.brief_id = p_brief_id
       AND aj.state IN ('queued','dispatched','running','awaiting_accept')
  )
  UPDATE agent_jobs aj
     SET state = 'cancelled', error_message = format('cascade: %s', p_reason), completed_at = NOW()
    FROM affected_jobs WHERE aj.id = affected_jobs.id;
  GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

  -- Step 6: cancel director_turns + director_iteration jobs on the
  -- document's conversation that are still in_progress.
  WITH active_turns AS (
    SELECT t.id FROM director_turns t
     JOIN conversations c ON c.id = t.conversation_id
     WHERE c.document_id = v_doc_id
       AND t.state = 'in_progress'
  )
  UPDATE director_turns t
     SET state = 'cancelled', completed_at = NOW()
    FROM active_turns WHERE t.id = active_turns.id;
  GET DIAGNOSTICS v_cancelled_turns = ROW_COUNT;

  -- Also cancel in-flight director_iteration agent_jobs.
  WITH affected_iter AS (
    SELECT aj.id FROM agent_jobs aj
     JOIN director_turns t ON aj.director_turn_id = t.id
     JOIN conversations c ON c.id = t.conversation_id
     WHERE c.document_id = v_doc_id
       AND aj.operation_type = 'director_iteration'
       AND aj.state IN ('queued','dispatched','running')
  )
  UPDATE agent_jobs aj
     SET state = 'cancelled', error_message = format('cascade: %s', p_reason), completed_at = NOW()
    FROM affected_iter WHERE aj.id = affected_iter.id;

  -- Step 7: cancel the brief itself.
  UPDATE briefs
     SET state = 'cancelled', cancelled_at = NOW(), current_stage_id = NULL
   WHERE id = p_brief_id;

  -- Step 8: emit cancel_cascade system event.
  INSERT INTO conversation_messages (
    conversation_id, role, sequence, event_type, event_payload, content, created_at
  )
  SELECT c.id, 'system',
    COALESCE((SELECT MAX(sequence) + 1 FROM conversation_messages WHERE conversation_id = c.id), 1),
    'cancel_cascade',
    jsonb_build_object(
      'brief_id', p_brief_id,
      'reason', p_reason,
      'pending_stages_cancelled', v_pending_stages,
      'completed_stages_retained', v_completed_stages,
      'workflows_cancelled', v_cancelled_workflows,
      'steps_cancelled', v_cancelled_steps,
      'jobs_cancelled', v_cancelled_jobs,
      'turns_cancelled', v_cancelled_turns
    ),
    format('Brief cancelled (%s pending stages cancelled, %s completed retained).', v_pending_stages, v_completed_stages),
    NOW()
   FROM conversations c
  WHERE c.document_id = v_doc_id;

  RETURN jsonb_build_object(
    'brief_id', p_brief_id,
    'pending_stages_cancelled', v_pending_stages,
    'completed_stages_retained', v_completed_stages,
    'workflows_cancelled', v_cancelled_workflows,
    'steps_cancelled', v_cancelled_steps,
    'jobs_cancelled', v_cancelled_jobs,
    'turns_cancelled', v_cancelled_turns
  );
END;
$$;

COMMENT ON FUNCTION cancel_brief(uuid, text) IS
  'Apollo-grade cascade cancel. Cancels brief + stages + workflows + workflow_steps + agent_jobs + director_turns in one atomic call. Idempotent. See docs/stelavox_brief_orchestration_v1_0.md §12.2.';

REVOKE ALL ON FUNCTION cancel_brief(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_brief(uuid, text) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 2. force_reset_document — admin Apollo reset button
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.force_reset_document(p_document_id uuid)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_brief_id UUID;
  v_cancelled_briefs INT := 0;
  v_cancelled_workflows INT := 0;
  v_cancelled_jobs INT := 0;
  v_cancelled_turns INT := 0;
BEGIN
  -- Cascade-cancel every active brief on this document.
  FOR v_brief_id IN
    SELECT id FROM briefs WHERE document_id = p_document_id AND state = 'active'
  LOOP
    PERFORM cancel_brief(v_brief_id, 'force_reset_document');
    v_cancelled_briefs := v_cancelled_briefs + 1;
  END LOOP;

  -- Catch any orphan workflows not linked to a brief stage.
  UPDATE workflows
    SET state='cancelled', cancelled_at=NOW()
   WHERE document_id = p_document_id
     AND state IN ('draft','approved','running','paused');
  GET DIAGNOSTICS v_cancelled_workflows = ROW_COUNT;

  -- Catch any orphan in-flight agent_jobs on the document.
  UPDATE agent_jobs
    SET state='cancelled',
        error_message='force_reset_document',
        completed_at=NOW()
   WHERE document_id = p_document_id
     AND state IN ('queued','dispatched','running','awaiting_accept');
  GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;

  -- Catch any orphan in_progress director_turns on the document's conversations.
  WITH t AS (
    SELECT dt.id FROM director_turns dt
     JOIN conversations c ON c.id = dt.conversation_id
    WHERE c.document_id = p_document_id AND dt.state = 'in_progress'
  )
  UPDATE director_turns dt SET state='cancelled', completed_at=NOW()
    FROM t WHERE dt.id = t.id;
  GET DIAGNOSTICS v_cancelled_turns = ROW_COUNT;

  RETURN jsonb_build_object(
    'document_id', p_document_id,
    'briefs_cancelled', v_cancelled_briefs,
    'orphan_workflows_cancelled', v_cancelled_workflows,
    'orphan_jobs_cancelled', v_cancelled_jobs,
    'orphan_turns_cancelled', v_cancelled_turns,
    'reset_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION force_reset_document(uuid) IS
  'Apollo reset button. Cancels every in-flight orchestration entity for a document. Admin-only. See docs/stelavox_brief_orchestration_v1_0.md §12.3.';

REVOKE ALL ON FUNCTION force_reset_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION force_reset_document(uuid) TO service_role;

COMMIT;
