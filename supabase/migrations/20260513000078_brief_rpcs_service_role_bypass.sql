-- Migration 078 — V1.x-A Brief RPCs allow service-role bypass.
-- Source: Discovered during V1.x-A §3.7 testing — apply_brief_proposal
-- and apply_brief_amendment rejected service-role calls because they
-- required auth.uid() to be non-NULL. Matches the create_document_with_layer_stack
-- pattern (Migration 019): service-role auth.uid() is NULL by design,
-- and RLS at the table layer is what protects cross-tenant access for
-- non-service callers. The RPCs do their own org-membership check only
-- for authenticated callers; service-role bypasses it.

CREATE OR REPLACE FUNCTION apply_brief_proposal(
  p_brief_id    UUID,
  p_goal_text   TEXT,
  p_preferences JSONB,
  p_stages      JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_brief      briefs%ROWTYPE;
  v_first_stage_id UUID;
  v_stage      JSONB;
  v_after      JSONB;
BEGIN
  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Authenticated callers must be org members. Service-role (v_caller IS NULL)
  -- bypasses this check; RLS at the table layer protects cross-tenant access.
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of brief organisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_brief.goal_text IS NOT NULL THEN
    RAISE EXCEPTION 'brief_already_populated: use apply_brief_amendment for deltas'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF jsonb_typeof(p_stages) <> 'array' OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'invalid_stages: expected non-empty JSONB array'
      USING ERRCODE = 'data_exception';
  END IF;

  UPDATE briefs
  SET goal_text   = p_goal_text,
      preferences = COALESCE(p_preferences, '{}'::jsonb),
      updated_at  = NOW()
  WHERE id = p_brief_id;

  FOR v_stage IN SELECT jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO brief_stages (
      brief_id, "order", title, description, trigger_type, trigger_config
    )
    VALUES (
      p_brief_id,
      (v_stage->>'order')::INTEGER,
      v_stage->>'title',
      v_stage->>'description',
      v_stage->>'trigger_type',
      COALESCE(v_stage->'trigger_config', '{}'::jsonb)
    );
  END LOOP;

  SELECT id INTO v_first_stage_id
  FROM brief_stages
  WHERE brief_id = p_brief_id
  ORDER BY "order" ASC
  LIMIT 1;

  UPDATE briefs SET current_stage_id = v_first_stage_id WHERE id = p_brief_id;

  v_after := jsonb_build_object(
    'goal_text',   p_goal_text,
    'preferences', COALESCE(p_preferences, '{}'::jsonb),
    'stages',      p_stages
  );

  INSERT INTO brief_amendments (
    brief_id, proposed_by, amendment_type, target_path, before, after,
    approved_by_user_id, reason
  )
  VALUES (
    p_brief_id, 'director', 'initial_brief', NULL,
    '{}'::jsonb, v_after,
    v_caller, 'Initial Brief proposed by Director and approved'
  );

  RETURN jsonb_build_object(
    'brief',  (SELECT row_to_json(b) FROM briefs b WHERE b.id = p_brief_id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order")
               FROM brief_stages s WHERE s.brief_id = p_brief_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION apply_brief_amendment(
  p_brief_id        UUID,
  p_amendment_type  TEXT,
  p_target_path     TEXT,
  p_after           JSONB,
  p_reason          TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_brief      briefs%ROWTYPE;
  v_before     JSONB;
  v_path_parts TEXT[];
  v_jsonb_path TEXT[];
BEGIN
  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Service-role bypass; authenticated callers must be org members.
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of brief organisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF v_brief.goal_text IS NULL THEN
    RAISE EXCEPTION 'brief_empty: use apply_brief_proposal for initial population'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_amendment_type IN ('insert_stage','remove_stage','reorder_stages','update_stage') THEN
    RAISE EXCEPTION 'not_implemented_in_v1xa: stage roadmap amendments land in V1.x-B'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF p_amendment_type = 'update_goal_text' THEN
    v_before := jsonb_build_object('goal_text', v_brief.goal_text);
    UPDATE briefs
    SET goal_text  = p_after #>> '{}',
        updated_at = NOW()
    WHERE id = p_brief_id;

    INSERT INTO brief_amendments (
      brief_id, proposed_by, amendment_type, target_path, before, after,
      approved_by_user_id, reason
    )
    VALUES (
      p_brief_id, 'director', p_amendment_type, p_target_path,
      v_before, p_after, v_caller, p_reason
    );

  ELSE
    IF p_target_path IS NULL OR p_target_path NOT LIKE 'preferences.%' THEN
      RAISE EXCEPTION 'invalid_target_path: expected preferences.<key>, got %', p_target_path
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_path_parts := string_to_array(substring(p_target_path FROM 13), '.');
    v_jsonb_path := v_path_parts;

    v_before := jsonb_build_object(
      'preferences', v_brief.preferences,
      'at', v_brief.preferences #> v_jsonb_path
    );

    UPDATE briefs
    SET preferences = jsonb_set(preferences, v_jsonb_path, p_after, TRUE),
        updated_at  = NOW()
    WHERE id = p_brief_id;

    INSERT INTO brief_amendments (
      brief_id, proposed_by, amendment_type, target_path, before, after,
      approved_by_user_id, reason
    )
    VALUES (
      p_brief_id, 'director', p_amendment_type, p_target_path,
      v_before, p_after, v_caller, p_reason
    );
  END IF;

  RETURN jsonb_build_object(
    'brief',  (SELECT row_to_json(b) FROM briefs b WHERE b.id = p_brief_id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order")
               FROM brief_stages s WHERE s.brief_id = p_brief_id)
  );
END;
$$;
