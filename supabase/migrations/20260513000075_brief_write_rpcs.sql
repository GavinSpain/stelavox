-- Migration 075 — V1.x-A Brief write RPCs (SECURITY DEFINER).
-- Source: stelavox_director_architecture_v2_0.md §6.
--
-- Two RPCs that are the only paths through which a Brief is mutated. The
-- API routes in app/api/brief/* call these; the SECURITY DEFINER wrapping
-- means RLS is bypassed during the mutation (the RPCs do their own org
-- check against auth.uid()). H-13: every function declares
-- SET search_path = public.
--
-- 1. apply_brief_proposal — populates an empty Brief from a Director-
--    proposed shape. One-shot: requires briefs.goal_text IS NULL at call
--    time. Writes briefs.goal_text + preferences, inserts the staged
--    roadmap into brief_stages, sets briefs.current_stage_id to the
--    first stage, and appends a brief_amendments row with
--    amendment_type='initial_brief'.
--
-- 2. apply_brief_amendment — applies a delta to a populated Brief.
--    V1.x-A scope: preferences and goal_text only. Stage roadmap
--    amendments (insert_stage / remove_stage / reorder_stages) move to
--    V1.x-B once trigger semantics exist; raising those amendment_types
--    here returns a not_implemented_in_v1xa error so the UI can surface
--    it cleanly.
--
-- Both RPCs:
--   - validate the caller is an org member of the Brief's organisation
--     (RAISE 'forbidden' if not)
--   - work atomically (function = transaction in PL/pgSQL)
--   - append a brief_amendments row capturing before/after JSONB
--   - return the new BriefStatePayload (built in lib/brief/getBriefState
--     server-side; here we return the brief row + stages array)

-- ---------------------------------------------------------------------------
-- apply_brief_proposal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_brief_proposal(
  p_brief_id    UUID,
  p_goal_text   TEXT,
  p_preferences JSONB,
  p_stages      JSONB         -- expected: JSONB array of stage objects
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_brief      briefs%ROWTYPE;
  v_first_stage_id UUID;
  v_stage      JSONB;
  v_after      JSONB;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: authenticated user required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
    WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of brief organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_brief.goal_text IS NOT NULL THEN
    RAISE EXCEPTION 'brief_already_populated: use apply_brief_amendment for deltas'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF jsonb_typeof(p_stages) <> 'array' OR jsonb_array_length(p_stages) = 0 THEN
    RAISE EXCEPTION 'invalid_stages: expected non-empty JSONB array'
      USING ERRCODE = 'data_exception';
  END IF;

  -- Apply the goal + preferences.
  UPDATE briefs
  SET goal_text   = p_goal_text,
      preferences = COALESCE(p_preferences, '{}'::jsonb),
      updated_at  = NOW()
  WHERE id = p_brief_id;

  -- Insert all stages from the input array.
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

  -- Resolve current_stage_id from the stored rows by lowest order
  -- (does not assume the input array was ordered).
  SELECT id INTO v_first_stage_id
  FROM brief_stages
  WHERE brief_id = p_brief_id
  ORDER BY "order" ASC
  LIMIT 1;

  UPDATE briefs SET current_stage_id = v_first_stage_id WHERE id = p_brief_id;

  -- Audit row.
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
    v_caller, 'Initial Brief proposed by Director and approved by user'
  );

  -- Return the populated brief + stages.
  RETURN jsonb_build_object(
    'brief',  (SELECT row_to_json(b) FROM briefs b WHERE b.id = p_brief_id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order")
               FROM brief_stages s WHERE s.brief_id = p_brief_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_brief_proposal(UUID, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_brief_proposal(UUID, TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_brief_proposal(UUID, TEXT, JSONB, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- apply_brief_amendment
-- ---------------------------------------------------------------------------
--
-- V1.x-A supported amendment_types:
--   - update_goal_text        — target_path NULL; after = TEXT (wrapped in jsonb 'text')
--   - update_voice            — target_path 'preferences.voice'
--   - add_constraint          — target_path 'preferences.constraints'
--   - update_constraints      — target_path 'preferences.constraints'
--   - add_decision            — target_path 'preferences.decisions'
--   - update_decisions        — target_path 'preferences.decisions'
--   - update_named_entities   — target_path 'preferences.named_entities'
--   - generic_preferences_set — target_path 'preferences.<custom>'; after = JSONB value
--
-- Anything outside this list (specifically insert_stage / remove_stage /
-- reorder_stages / update_stage) raises 'not_implemented_in_v1xa'. V1.x-B
-- will widen the supported set when stage triggers go live.

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
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: authenticated user required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_brief FROM briefs WHERE id = p_brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', p_brief_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
    WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of brief organisation'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_brief.goal_text IS NULL THEN
    RAISE EXCEPTION 'brief_empty: use apply_brief_proposal for initial population'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Stage roadmap amendments — deferred to V1.x-B.
  IF p_amendment_type IN ('insert_stage','remove_stage','reorder_stages','update_stage') THEN
    RAISE EXCEPTION 'not_implemented_in_v1xa: stage roadmap amendments land in V1.x-B'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- update_goal_text — special-cased because target is a scalar column,
  -- not a JSONB path.
  IF p_amendment_type = 'update_goal_text' THEN
    v_before := jsonb_build_object('goal_text', v_brief.goal_text);
    UPDATE briefs
    SET goal_text  = p_after #>> '{}',                  -- unwrap scalar JSONB
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
    -- All other supported types mutate briefs.preferences via jsonb_set
    -- at the supplied target_path.
    IF p_target_path IS NULL OR p_target_path NOT LIKE 'preferences.%' THEN
      RAISE EXCEPTION 'invalid_target_path: expected preferences.<key>, got %', p_target_path
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    -- Convert 'preferences.constraints' → ARRAY['constraints']. (The
    -- 'preferences' prefix is implicit in the column name.)
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

REVOKE ALL ON FUNCTION apply_brief_amendment(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_brief_amendment(UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_brief_amendment(UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;
