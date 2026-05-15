-- Migration 120 — V1.x-B.2.3: push-model stage triggers + auto-approve flag.
--
-- Source: stelavox_v1x_b_2_build_checklist_v1_0.md §5.2.1 M-120 +
--         §5.2.4 (push-model end-to-end) +
--         Director Architecture v2.0 §8.4 (scheduler-invokes-Director-on-stage-trigger).
--
-- Three changes in lockstep:
--
-- 1. ALTER briefs ADD COLUMN auto_approve_workflow_proposals BOOLEAN
--    NOT NULL DEFAULT FALSE
--      When true, the iteration-runner auto-approves any workflow_proposal
--      it emits (calls /api/director/turns/[turnId]/auto-approve-workflow
--      after the proposal is persisted). The flag is set when the user
--      ticks "Auto-approve subsequent stages" on the BriefProposalCard.
--
-- 2. Extend evaluate_ready_stage_triggers (M-102) — push-model upgrade.
--      v1: marks ready stages 'proposing' + emits stage_trigger_fired
--          system event (pull-model — Director sees event on next user
--          engagement).
--      v2 (this migration): ALSO inserts a director_iteration agent_jobs
--          row to invoke the Director immediately, subject to:
--            - H-23 storm prevention: skip insert if there's already an
--              in-flight director_iteration on this conversation_id
--              (queue_status IN 'queued','dispatched','running')
--            - The brief's document must have a current conversation
--              (no synth-from-scratch in this migration; deferred)
--          Returns the same INTEGER (count of triggers fired).
--
-- 3. Extend complete_brief_stage_workflow (M-097) — when it advances
--    current_stage_id, immediately call evaluate_ready_stage_triggers()
--    so the next stage's trigger evaluates within the same accept_agent_job
--    transaction (no 30s pg_cron wait). The pg_cron schedule remains
--    as a safety floor.
--
-- pg_notify is NOT added to this trigger directly — the M-109
-- agent_jobs_notify_completion trigger already fires on terminal
-- queue_status transitions for ALL agent_jobs (including the
-- director_iteration row this trigger inserts), so the dispatcher
-- gets notified via the existing path.

-- ---------------------------------------------------------------------------
-- 1. briefs.auto_approve_workflow_proposals column
-- ---------------------------------------------------------------------------

ALTER TABLE briefs
  ADD COLUMN auto_approve_workflow_proposals BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------------
-- 2. evaluate_ready_stage_triggers — extended with push-model insert
-- ---------------------------------------------------------------------------
-- Replaces the M-102 implementation. Same return type, same external
-- behavior for callers that already use it (the pg_cron schedule from
-- M-102 continues to call this function unchanged).
--
-- The new behavior: after marking the stage 'proposing' and emitting
-- the system event, also INSERT a director_iteration agent_jobs row
-- with:
--   operation_type='director_iteration'
--   traffic_class=1 (interactive Director)
--   queue_status='queued'
--   director_turn_id = (newly created director_turns row pointing at the
--                       most-recent conversation for the document)
--   iteration_state.user_message = synthesised
--     "[SYSTEM EVENT: Stage N complete; plan workflow for Stage N+1]"
--   conversation_context = empty (the Director will read brief state via
--                                 its tools)
--
-- H-23 mitigation: skip insertion if there's already an in-flight
-- director_iteration for this conversation_id. The trigger will fire
-- again the next time stages are evaluated (pg_cron 30s OR manual
-- invocation from complete_brief_stage_workflow).

CREATE OR REPLACE FUNCTION evaluate_ready_stage_triggers()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fired INTEGER := 0;
  v_stage RECORD;
  v_predecessor_completed BOOLEAN;
  v_predecessor_order INTEGER;
  v_brief RECORD;
  v_conversation_id UUID;
  v_in_flight_count INTEGER;
  v_new_turn_id UUID;
  v_initial_iteration_state JSONB;
BEGIN
  FOR v_stage IN
    SELECT bs.id, bs.brief_id, bs."order" AS stage_order, bs.title,
           bs.trigger_type, bs.trigger_config
    FROM brief_stages bs
    JOIN briefs b ON b.id = bs.brief_id
    WHERE bs.status = 'planned'
      AND bs.trigger_type = 'after_stage'
      AND b.status = 'active'
  LOOP
    v_predecessor_order := NULLIF(v_stage.trigger_config->>'after_stage_order', '')::INTEGER;
    IF v_predecessor_order IS NULL THEN
      CONTINUE;  -- malformed trigger_config; skip
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM brief_stages
      WHERE brief_id = v_stage.brief_id
        AND "order" = v_predecessor_order
        AND status = 'completed'
    ) INTO v_predecessor_completed;

    IF NOT v_predecessor_completed THEN
      CONTINUE;
    END IF;

    -- Mark stage proposing (idempotent on status='planned' guard).
    UPDATE brief_stages
    SET status = 'proposing'
    WHERE id = v_stage.id AND status = 'planned';

    -- Resolve brief + document for the system event + director_iteration.
    SELECT b.document_id, b.organisation_id, b.auto_approve_workflow_proposals
    INTO v_brief
    FROM briefs b WHERE b.id = v_stage.brief_id;

    -- Emit system event (pull-model surface, kept for visibility).
    PERFORM _emit_system_event(
      v_brief.document_id,
      'stage_trigger_fired',
      jsonb_build_object(
        'brief_id',     v_stage.brief_id,
        'stage_id',     v_stage.id,
        'stage_order',  v_stage.stage_order,
        'stage_title',  v_stage.title
      ),
      'scheduler_trigger',
      format('Stage %s "%s" trigger fired — Director should plan its workflow.',
             v_stage.stage_order, v_stage.title)
    );

    -- Push-model: INSERT a director_iteration agent_job to invoke the
    -- Director immediately. Subject to H-23 storm prevention + presence
    -- of a conversation surface.

    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE document_id = v_brief.document_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_conversation_id IS NULL THEN
      v_fired := v_fired + 1;
      CONTINUE;  -- no conversation surface; pull-model only
    END IF;

    -- H-23: defer if any director_iteration is already in-flight on
    -- this conversation. The next time this trigger evaluates the
    -- stage (next pg_cron tick OR next workflow completion), it will
    -- re-attempt insertion.
    SELECT COUNT(*) INTO v_in_flight_count
    FROM agent_jobs aj
    JOIN director_turns dt ON dt.id = aj.director_turn_id
    WHERE dt.conversation_id = v_conversation_id
      AND aj.operation_type = 'director_iteration'
      AND aj.queue_status IN ('queued', 'dispatched', 'running');

    IF v_in_flight_count > 0 THEN
      v_fired := v_fired + 1;
      CONTINUE;  -- defer to next evaluation cycle
    END IF;

    -- Create a director_turns row for this push-model invocation.
    INSERT INTO director_turns (conversation_id, status)
    VALUES (v_conversation_id, 'in_progress')
    RETURNING id INTO v_new_turn_id;

    -- Build the initial iteration_state. user_message is the synthesised
    -- system event prompt; conversation_context is empty (Director uses
    -- read tools to gather state). messages array starts with just the
    -- user message.
    v_initial_iteration_state := jsonb_build_object(
      '__schema_version', 1,
      'conversation_context', '[]'::jsonb,
      'messages', jsonb_build_array(
        jsonb_build_object(
          'role', 'user',
          'content', format(
            '[SYSTEM EVENT: Stage %s "%s" trigger fired — plan the workflow for this stage. Read the brief and project profile, then propose the workflow.]',
            v_stage.stage_order, v_stage.title
          )
        )
      ),
      'user_message', jsonb_build_object(
        'role', 'user',
        'content', format(
          '[SYSTEM EVENT: Stage %s "%s" trigger fired — plan the workflow for this stage. Read the brief and project profile, then propose the workflow.]',
          v_stage.stage_order, v_stage.title
        )
      ),
      'system_prompt_version', '1.8',
      'model', 'claude-haiku-4-5',
      'mentioned_node_ids', '[]'::jsonb
    );

    INSERT INTO agent_jobs (
      organisation_id, document_id,
      operation_type, status, queue_status,
      triggered_by, cause, traffic_class, route,
      director_turn_id, parent_iteration_id, iteration_number,
      iteration_state
    ) VALUES (
      v_brief.organisation_id, v_brief.document_id,
      'director_iteration', 'pending', 'queued',
      'stage_trigger', 'stage_trigger_fired', 1, 'platform',
      v_new_turn_id, NULL, 1,
      v_initial_iteration_state
    );

    v_fired := v_fired + 1;
  END LOOP;

  RETURN v_fired;
END;
$$;

REVOKE ALL ON FUNCTION evaluate_ready_stage_triggers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION evaluate_ready_stage_triggers() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. complete_brief_stage_workflow — fire evaluator inline after advance
-- ---------------------------------------------------------------------------
-- Replaces the M-097 implementation. Same external return shape; only
-- adds the synchronous evaluator call.

CREATE OR REPLACE FUNCTION complete_brief_stage_workflow(
  p_workflow_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller        UUID := auth.uid();
  v_stage         brief_stages%ROWTYPE;
  v_brief         briefs%ROWTYPE;
  v_next_stage_id UUID;
  v_evaluator_fired INTEGER;
BEGIN
  SELECT * INTO v_stage FROM brief_stages WHERE workflow_id = p_workflow_id LIMIT 1;
  IF NOT FOUND THEN
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

    -- B.2.3 push-model: fire the evaluator inline so the next stage's
    -- after_stage trigger evaluates immediately rather than waiting for
    -- the 30s pg_cron tick. The evaluator handles H-23 storm prevention.
    SELECT evaluate_ready_stage_triggers() INTO v_evaluator_fired;

    RETURN jsonb_build_object(
      'stage_id', v_stage.id,
      'closed', true,
      'next_stage_id', v_next_stage_id,
      'evaluator_fired_count', v_evaluator_fired
    );
  END IF;

  -- Last stage — propagate Brief completion.
  RETURN propagate_brief_completion(v_stage.brief_id);
END;
$$;

REVOKE ALL ON FUNCTION complete_brief_stage_workflow(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_brief_stage_workflow(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_brief_stage_workflow(UUID) TO service_role;
