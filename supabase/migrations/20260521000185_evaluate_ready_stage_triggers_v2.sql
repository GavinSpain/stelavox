-- M-185 — evaluate_ready_stage_triggers rewrite for the simplified
-- brief model.
--
-- Phase D of the Director simplification refactor. The push-model
-- evaluator (from M-102 → M-120) used the now-deprecated 'proposing'
-- status and emitted a generic system-event message that didn't
-- include the stage's actual prompt. The new model:
--
--   - Stage status transition: 'planned' → 'planning' (was 'proposing'
--     — renamed in M-183).
--   - The director_iteration's initial user message includes the stage's
--     stored `prompt` so the Director knows exactly what work to plan.
--     If a stage has no prompt (workflow was pre-planned at brief-
--     proposal time), this evaluator should not have picked it up — but
--     defence in depth: we skip such stages with a CONTINUE.
--   - system_prompt_version pinned to '1.24' (matches the production
--     Director config at the time M-184 lands).
--
-- The H-23 storm-prevention check (no concurrent in-flight
-- director_iteration on the same conversation) is preserved.

CREATE OR REPLACE FUNCTION public.evaluate_ready_stage_triggers()
  RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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
  v_stage_prompt TEXT;
  v_user_message TEXT;
BEGIN
  FOR v_stage IN
    SELECT bs.id, bs.brief_id, bs."order" AS stage_order, bs.title,
           bs.trigger_type, bs.trigger_config, bs.prompt, bs.workflow_id
    FROM brief_stages bs
    JOIN briefs b ON b.id = bs.brief_id
    WHERE bs.status = 'planned'
      AND bs.trigger_type = 'after_stage'
      AND b.status = 'active'
  LOOP
    -- Skip stages that already have a workflow attached at brief-
    -- proposal time. Those are dispatched directly when their
    -- predecessor completes; they don't need a stage-planning
    -- Director turn.
    IF v_stage.workflow_id IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- A stage with no workflow MUST have a prompt (DB CHECK constraint
    -- brief_stages_planning_source_check). Defence in depth.
    IF v_stage.prompt IS NULL OR length(trim(v_stage.prompt)) = 0 THEN
      CONTINUE;
    END IF;

    v_predecessor_order := NULLIF(v_stage.trigger_config->>'after_stage_order', '')::INTEGER;
    IF v_predecessor_order IS NULL THEN
      CONTINUE;
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

    -- Resolve brief + document.
    SELECT b.id, b.organisation_id, b.document_id, b.goal_text
    INTO v_brief
    FROM briefs b
    WHERE b.id = v_stage.brief_id;

    -- Mark stage planning (idempotent on status='planned' guard).
    UPDATE brief_stages
    SET status = 'planning'
    WHERE id = v_stage.id AND status = 'planned';

    -- Emit a system event into the conversation so the user can see
    -- (in their conversation thread) that the system is now planning
    -- stage N.
    SELECT id INTO v_conversation_id
    FROM conversations
    WHERE document_id = v_brief.document_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_conversation_id IS NOT NULL THEN
      INSERT INTO conversation_messages (
        conversation_id, role, event_type, content, sequence
      )
      VALUES (
        v_conversation_id,
        'system',
        'stage_trigger_fired',
        format('Stage %s "%s" trigger fired — planning the workflow.',
               v_stage.stage_order, v_stage.title),
        (SELECT COALESCE(MAX(sequence), 0) + 1 FROM conversation_messages WHERE conversation_id = v_conversation_id)
      );
    END IF;

    IF v_conversation_id IS NULL THEN
      v_fired := v_fired + 1;
      CONTINUE;
    END IF;

    -- H-23 storm prevention.
    SELECT COUNT(*) INTO v_in_flight_count
    FROM agent_jobs aj
    JOIN director_turns dt ON dt.id = aj.director_turn_id
    WHERE dt.conversation_id = v_conversation_id
      AND aj.operation_type = 'director_iteration'
      AND aj.queue_status IN ('queued', 'dispatched', 'running');

    IF v_in_flight_count > 0 THEN
      v_fired := v_fired + 1;
      CONTINUE;
    END IF;

    -- Build the user message: the system event + the stage's actual
    -- prompt. The Director's v1.24 system prompt teaches it to call
    -- propose_workflow when it sees a stage_trigger_fired event.
    v_stage_prompt := v_stage.prompt;
    v_user_message := format(
      E'[SYSTEM EVENT: Stage %s "%s" trigger fired.]\n\nStage prompt: %s\n\nPlan the workflow for this stage. Read the brief and project profile, then call propose_workflow with the concrete steps.',
      v_stage.stage_order, v_stage.title, v_stage_prompt
    );

    -- Create the director_turn + first agent_jobs row.
    INSERT INTO director_turns (conversation_id, status)
    VALUES (v_conversation_id, 'in_progress')
    RETURNING id INTO v_new_turn_id;

    v_initial_iteration_state := jsonb_build_object(
      '__schema_version', 1,
      'conversation_context', '[]'::jsonb,
      'messages', jsonb_build_array(
        jsonb_build_object('role', 'user', 'content', v_user_message)
      ),
      'user_message', jsonb_build_object('role', 'user', 'content', v_user_message),
      'system_prompt_version', '1.24',
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
$function$;
