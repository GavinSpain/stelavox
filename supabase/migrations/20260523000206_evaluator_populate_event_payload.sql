-- M-206 — evaluate_ready_stage_triggers populates event_payload + cause.
--
-- The evaluator's INSERT into conversation_messages was missing two
-- fields that lib/director/conversation-context.ts:312
-- (renderSystemEventForContext) consumes when building the Director's
-- conversation context window:
--
--   - event_payload — JSON blob with stage identifiers + brief reference.
--     conversation-context.ts inlines this into the rendered system
--     event string ("[SYSTEM EVENT: stage_trigger_fired cause=...
--     payload={...}] Stage 2 ..."), so downstream Director iterations
--     can see WHICH stage fired and WHICH brief it belongs to without
--     parsing the content string.
--   - cause — a short cause label for telemetry / filtering.
--
-- Pre-M-206 the INSERT only set conversation_id, role, event_type,
-- content, sequence. Both event_payload and cause were NULL on every
-- emitted event. Surfaced 2026-05-23 by the M-205 test-cleanup pass
-- when the v1x-b1 evaluator test asserted these fields.
--
-- Source: stelavox_brief_orchestration_v1_0.md §11.6 (test cleanup
-- follow-on) + lib/director/conversation-context.ts:303 SystemEventRow.

BEGIN;

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
        conversation_id, role, event_type, event_payload, cause, content, sequence
      )
      VALUES (
        v_conversation_id,
        'system',
        'stage_trigger_fired',
        -- M-206: payload carries brief + stage identifiers so
        -- conversation-context.ts:renderSystemEventForContext can
        -- inline them into the Director's context window. Downstream
        -- consumers (UI status indicators, filter-by-brief audit
        -- queries, telemetry) read these fields directly.
        jsonb_build_object(
          'brief_id', v_brief.id,
          'stage_id', v_stage.id,
          'stage_order', v_stage.stage_order,
          'stage_title', v_stage.title,
          'trigger_type', v_stage.trigger_type
        ),
        'scheduler_trigger',
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

    -- Create director_turn + first iteration agent_job.
    INSERT INTO director_turns (conversation_id, status)
    VALUES (v_conversation_id, 'in_progress')
    RETURNING id INTO v_new_turn_id;

    -- Build the initial iteration_state. The user_message embeds the
    -- stage's stored prompt so the Director knows exactly what to plan.
    v_stage_prompt := v_stage.prompt;
    v_user_message := format(
      E'[SYSTEM EVENT: stage_trigger_fired — Stage %s of %L]\n\nStage %s "%s" of the active brief has been triggered. The brief''s goal: %L\n\nPlan the workflow for this stage now. Stage instructions:\n\n%s',
      v_stage.stage_order, v_brief.id::TEXT,
      v_stage.stage_order, v_stage.title,
      v_brief.goal_text,
      v_stage_prompt
    );

    v_initial_iteration_state := jsonb_build_object(
      '__schema_version', 1,
      'conversation_context', '[]'::jsonb,
      'messages', jsonb_build_array(
        jsonb_build_object('role', 'user', 'content', v_user_message)
      ),
      'user_message', jsonb_build_object('role', 'user', 'content', v_user_message),
      'system_prompt_version', '1.24',
      'model', NULL,
      'mentioned_node_ids', '[]'::jsonb
    );

    INSERT INTO agent_jobs (
      organisation_id, document_id, operation_type, status, queue_status,
      triggered_by, cause, traffic_class, director_turn_id, iteration_number,
      iteration_state
    )
    VALUES (
      v_brief.organisation_id, v_brief.document_id, 'director_iteration',
      'pending', 'queued',
      'stage_trigger', 'stage_trigger_fired', 1,
      v_new_turn_id, 1,
      v_initial_iteration_state
    );

    v_fired := v_fired + 1;
  END LOOP;
  RETURN v_fired;
END;
$function$;

COMMIT;
