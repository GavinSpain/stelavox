-- M-189 — accept_brief: persist brief_stages.prompt.
--
-- M-183 added brief_stages.prompt (TEXT, nullable) for the
-- workflow-XOR-prompt-per-stage model. The propose_brief artefact
-- carries `prompt` per stage when the stage is prompt-deferred, and
-- /api/brief/proposals/approve passes the artefact verbatim into
-- accept_brief.
--
-- accept_brief's body was authored in V1.x-A.1 (pre-M-183); its
-- brief_stages INSERT statement lists `brief_id, "order", title,
-- description, trigger_type, trigger_config, status` — no `prompt`.
-- So every approve call has been silently dropping the prompt.
--
-- Surfaced 2026-05-22 by user-driven test: stage 1 ran cleanly,
-- stage 2 stayed in 'planned' status forever because
-- evaluate_ready_stage_triggers (M-185) skips stages with
-- NULL prompt (defence-in-depth check in the loop body).
--
-- Fix: rewrite accept_brief's INSERT to include the prompt column.
-- Everything else preserved verbatim.

CREATE OR REPLACE FUNCTION public.accept_brief(p_document_id uuid, p_goal_text text, p_stages jsonb)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_caller          UUID := auth.uid();
  v_doc             documents%ROWTYPE;
  v_brief_id        UUID := gen_random_uuid();
  v_first_stage_id  UUID;
  v_stage           JSONB;
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

  INSERT INTO briefs (
    id, document_id, organisation_id, goal_text, status,
    sequence_position, cause, approved_at, started_at
  ) VALUES (
    v_brief_id, p_document_id, v_doc.organisation_id, p_goal_text, 'active',
    0, 'user_initial', NOW(), NOW()
  );

  FOR v_stage IN SELECT jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO brief_stages (
      brief_id, "order", title, description, trigger_type, trigger_config, status, prompt
    ) VALUES (
      v_brief_id,
      (v_stage->>'order')::INTEGER,
      v_stage->>'title',
      v_stage->>'description',
      v_stage->>'trigger_type',
      COALESCE(v_stage->'trigger_config', '{}'::jsonb),
      'planned',
      -- 2026-05-22 M-189 — persist the stage prompt for prompt-deferred
      -- stages. NULL when the stage is workflow-bound (the route
      -- handler creates the workflow row + UPDATEs workflow_id after
      -- this RPC returns).
      NULLIF(v_stage->>'prompt', '')
    );
  END LOOP;

  SELECT id INTO v_first_stage_id
  FROM brief_stages WHERE brief_id = v_brief_id ORDER BY "order" ASC LIMIT 1;

  UPDATE briefs SET current_stage_id = v_first_stage_id WHERE id = v_brief_id;

  RETURN jsonb_build_object(
    'brief',           (SELECT row_to_json(b) FROM briefs b WHERE b.id = v_brief_id),
    'stages',          (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order") FROM brief_stages s WHERE s.brief_id = v_brief_id),
    'initial_status',  'active',
    'queue_position',  0
  );
END;
$function$;
