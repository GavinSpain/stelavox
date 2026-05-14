-- Migration 097 — V1.x-B.1.1: Brief lifecycle SECURITY DEFINER RPCs.
-- Source: stelavox_v1x_b_1_1_build_checklist_v1_0.md §3.1 T-1.7
--         + design record §10 (sequential multi-Brief)
--         + design record §12 (tiered system event surfacing).
--
-- Closes the V1.x-A.1 carry-over gap: workflow_complete → stage_complete
-- → brief_complete propagation never wired. Adds queue-promotion
-- mechanics for sequential multi-Brief.
--
-- Four RPCs:
--   1. _emit_system_event — internal helper; inserts a role='system'
--      row into the most-recent conversation for a document.
--   2. propagate_brief_completion — checks all stages completed;
--      transitions Brief; emits brief_completed; auto-promotes next.
--   3. complete_brief_stage_workflow — called when the last step in a
--      workflow accepts; transitions stage; emits stage_completed;
--      advances current_stage_id or calls propagate_brief_completion.
--   4. promote_next_queued_brief — finds lowest sequence_position
--      queued; transitions to active; emits brief_activated.
--   5. cancel_brief revised — emits cancel_cascade; auto-promotes next.
--
-- All RPCs allow service-role bypass (auth.uid() IS NULL) and check
-- org membership for authenticated callers.
-- All include SET search_path = public (H-13).

-- ---------------------------------------------------------------------------
-- 1. _emit_system_event — internal helper.
-- ---------------------------------------------------------------------------
-- Finds the most-recent conversation for a document and inserts a
-- role='system' row with the given event_type + payload + cause.
-- Returns the inserted message id. If no conversation exists, returns
-- NULL (no event surface available) — caller decides whether to raise.

CREATE OR REPLACE FUNCTION _emit_system_event(
  p_document_id UUID,
  p_event_type  TEXT,
  p_event_payload JSONB,
  p_cause       TEXT,
  p_content     TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conversation_id UUID;
  v_next_sequence   INTEGER;
  v_message_id      UUID;
BEGIN
  SELECT id INTO v_conversation_id
  FROM conversations
  WHERE document_id = p_document_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_conversation_id IS NULL THEN
    RETURN NULL;  -- no conversation surface; event not surfaced (rare edge case).
  END IF;

  SELECT COALESCE(MAX(sequence), 0) + 1
  INTO v_next_sequence
  FROM conversation_messages
  WHERE conversation_id = v_conversation_id;

  INSERT INTO conversation_messages (
    conversation_id, role, content, sequence, event_type, event_payload, cause
  ) VALUES (
    v_conversation_id,
    'system',
    p_content,
    v_next_sequence,
    p_event_type,
    p_event_payload,
    p_cause
  ) RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION _emit_system_event(UUID, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _emit_system_event(UUID, TEXT, JSONB, TEXT, TEXT) TO service_role;
-- Authenticated callers don't invoke this directly; the lifecycle RPCs do.

-- ---------------------------------------------------------------------------
-- 2. propagate_brief_completion — close Brief if all stages done.
-- ---------------------------------------------------------------------------
-- Called by complete_brief_stage_workflow after marking the last stage
-- of a Brief complete. Also safe to call defensively.

CREATE OR REPLACE FUNCTION propagate_brief_completion(
  p_brief_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller        UUID := auth.uid();
  v_brief         briefs%ROWTYPE;
  v_pending_count INTEGER;
  v_promoted_id   UUID;
BEGIN
  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Idempotent: already completed or cancelled → no-op.
  IF v_brief.status IN ('completed','cancelled') THEN
    RETURN jsonb_build_object('brief_id', p_brief_id, 'already_terminal', true);
  END IF;

  SELECT COUNT(*) INTO v_pending_count
  FROM brief_stages
  WHERE brief_id = p_brief_id AND status NOT IN ('completed','skipped','cancelled');

  IF v_pending_count > 0 THEN
    -- Not all stages done — Brief stays active.
    RETURN jsonb_build_object('brief_id', p_brief_id, 'pending_stages', v_pending_count);
  END IF;

  -- All stages terminal — close the Brief.
  UPDATE briefs
  SET status = 'completed',
      completed_at = NOW(),
      current_stage_id = NULL
  WHERE id = p_brief_id;

  PERFORM _emit_system_event(
    v_brief.document_id,
    'brief_completed',
    jsonb_build_object('brief_id', p_brief_id, 'goal_text', v_brief.goal_text),
    'workflow_complete',
    'Brief completed.'
  );

  -- Auto-promote next queued Brief on the same document.
  v_promoted_id := promote_next_queued_brief(v_brief.document_id);

  RETURN jsonb_build_object(
    'brief_id',          p_brief_id,
    'closed',            true,
    'promoted_brief_id', v_promoted_id
  );
END;
$$;

REVOKE ALL ON FUNCTION propagate_brief_completion(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION propagate_brief_completion(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION propagate_brief_completion(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. complete_brief_stage_workflow — workflow's last step accepted.
-- ---------------------------------------------------------------------------
-- Called by the extended accept_agent_job (M-098) when a workflow_step's
-- agent_job acceptance is the last incomplete step in its workflow.
-- Looks up the linked brief_stage, transitions it, advances Brief or
-- triggers propagation.

CREATE OR REPLACE FUNCTION complete_brief_stage_workflow(
  p_workflow_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller        UUID := auth.uid();
  v_stage         brief_stages%ROWTYPE;
  v_brief         briefs%ROWTYPE;
  v_next_stage_id UUID;
BEGIN
  SELECT * INTO v_stage FROM brief_stages WHERE workflow_id = p_workflow_id LIMIT 1;
  IF NOT FOUND THEN
    -- Workflow isn't linked to any brief_stage (e.g. one-off workflow) — no-op.
    RETURN jsonb_build_object('workflow_id', p_workflow_id, 'no_linked_stage', true);
  END IF;

  SELECT * INTO v_brief FROM briefs WHERE id = v_stage.brief_id;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Idempotent: already completed → no-op.
  IF v_stage.status = 'completed' THEN
    RETURN jsonb_build_object('stage_id', v_stage.id, 'already_completed', true);
  END IF;

  UPDATE brief_stages
  SET status = 'completed', completed_at = NOW()
  WHERE id = v_stage.id;

  PERFORM _emit_system_event(
    v_brief.document_id,
    'stage_completed',
    jsonb_build_object(
      'brief_id',  v_stage.brief_id,
      'stage_id',  v_stage.id,
      'order',     v_stage."order",
      'title',     v_stage.title
    ),
    'workflow_complete',
    format('Stage %s "%s" completed.', v_stage."order", v_stage.title)
  );

  -- Find next stage in order; advance current_stage_id or close Brief.
  SELECT id INTO v_next_stage_id
  FROM brief_stages
  WHERE brief_id = v_stage.brief_id AND "order" > v_stage."order"
  ORDER BY "order" ASC LIMIT 1;

  IF v_next_stage_id IS NOT NULL THEN
    UPDATE briefs SET current_stage_id = v_next_stage_id WHERE id = v_stage.brief_id;
    -- Stage trigger evaluation (firing the next stage) is the scheduler
    -- tick body's job (M-099 + lib/scheduler/ session 2).
    RETURN jsonb_build_object(
      'stage_id', v_stage.id,
      'closed', true,
      'next_stage_id', v_next_stage_id
    );
  END IF;

  -- Last stage — propagate Brief completion.
  RETURN propagate_brief_completion(v_stage.brief_id);
END;
$$;

REVOKE ALL ON FUNCTION complete_brief_stage_workflow(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_brief_stage_workflow(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_brief_stage_workflow(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. promote_next_queued_brief — activate the next queued Brief.
-- ---------------------------------------------------------------------------
-- Called by propagate_brief_completion + cancel_brief after the active
-- Brief reaches a terminal state. Finds the lowest sequence_position
-- queued Brief on the document, transitions it to active, emits
-- brief_activated.
--
-- Returns the promoted Brief id, or NULL if no queued Brief exists.

CREATE OR REPLACE FUNCTION promote_next_queued_brief(
  p_document_id UUID
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_next_brief briefs%ROWTYPE;
BEGIN
  SELECT * INTO v_next_brief
  FROM briefs
  WHERE document_id = p_document_id AND status = 'queued'
  ORDER BY sequence_position ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE briefs
  SET status = 'active',
      started_at = NOW(),
      cause = 'sequence_promotion'
  WHERE id = v_next_brief.id;

  PERFORM _emit_system_event(
    p_document_id,
    'brief_activated',
    jsonb_build_object(
      'brief_id',          v_next_brief.id,
      'sequence_position', v_next_brief.sequence_position,
      'goal_text',         v_next_brief.goal_text
    ),
    'sequence_promotion',
    format('Brief activated from queue (position %s).', v_next_brief.sequence_position)
  );

  -- Stage 1 trigger fires via the scheduler tick body (M-099 + session 2).
  -- For B.1.1 the system event surfaces the activation; the actual
  -- Director-turn enqueue is a session-2 dispatcher concern.

  RETURN v_next_brief.id;
END;
$$;

REVOKE ALL ON FUNCTION promote_next_queued_brief(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION promote_next_queued_brief(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION promote_next_queued_brief(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. cancel_brief revised — emits cancel_cascade + auto-promotes next.
-- ---------------------------------------------------------------------------
-- Replaces V1.x-A.1's cancel_brief (M-086 §4). New: cascade summary,
-- system event emission, queue auto-promotion. Signature changes from
-- (UUID) to (UUID, TEXT) — drop the old one explicitly first.

DROP FUNCTION IF EXISTS cancel_brief(UUID);

CREATE OR REPLACE FUNCTION cancel_brief(
  p_brief_id UUID,
  p_reason   TEXT DEFAULT 'user_cancelled'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_brief           briefs%ROWTYPE;
  v_cancelled_count INTEGER := 0;
  v_completed_count INTEGER := 0;
  v_promoted_id     UUID;
BEGIN
  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_brief.status NOT IN ('planned','queued','active') THEN
    RAISE EXCEPTION 'invalid_status: cannot cancel brief in status %', v_brief.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Compute cascade summary BEFORE updating: count stages by terminal status.
  SELECT
    COUNT(*) FILTER (WHERE status NOT IN ('completed','skipped','cancelled')),
    COUNT(*) FILTER (WHERE status = 'completed')
  INTO v_cancelled_count, v_completed_count
  FROM brief_stages WHERE brief_id = p_brief_id;

  -- Cascade-cancel non-terminal stages.
  UPDATE brief_stages
  SET status = 'cancelled', completed_at = NOW()
  WHERE brief_id = p_brief_id
    AND status NOT IN ('completed','skipped','cancelled');

  -- Transition Brief.
  UPDATE briefs
  SET status = 'cancelled',
      cancelled_at = NOW(),
      current_stage_id = NULL
  WHERE id = p_brief_id;

  PERFORM _emit_system_event(
    v_brief.document_id,
    'cancel_cascade',
    jsonb_build_object(
      'brief_id',         p_brief_id,
      'reason',           p_reason,
      'cancelled_count',  v_cancelled_count,
      'completed_count',  v_completed_count
    ),
    'user_action',
    format('Brief cancelled (%s pending stages cancelled, %s completed retained).',
           v_cancelled_count, v_completed_count)
  );

  -- Only auto-promote if the cancelled Brief was the active one.
  -- Cancelling a queued Brief is a queue-removal; no promotion needed.
  IF v_brief.status = 'active' THEN
    v_promoted_id := promote_next_queued_brief(v_brief.document_id);
  END IF;

  RETURN jsonb_build_object(
    'brief_id',          p_brief_id,
    'cancelled_count',   v_cancelled_count,
    'completed_count',   v_completed_count,
    'promoted_brief_id', v_promoted_id
  );
END;
$$;

REVOKE ALL ON FUNCTION cancel_brief(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_brief(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_brief(UUID, TEXT) TO service_role;
