-- Migration 086 — V1.x-A.1: SECURITY DEFINER RPCs for Profile + Brief.
-- Source: stelavox_director_architecture_v2_1_0.md §6 + v1x-a1 checklist §3.1 T-1.8.
--
-- Four RPCs:
--   1. apply_profile_amendment — mutates project_profiles.preferences or
--      goal_text + writes profile_amendments audit row.
--   2. accept_brief — atomic: creates briefs + brief_stages (+ optional
--      first-stage workflow + steps) from a <brief_proposal> approval.
--   3. complete_brief_stage — transitions a stage to 'completed',
--      advances briefs.current_stage_id to next stage, marks Brief
--      'completed' if last stage.
--   4. cancel_brief — transitions a Brief to 'cancelled', releasing the
--      partial unique index slot for a new active Brief.
--
-- All RPCs allow service-role bypass (auth.uid() IS NULL) and check
-- org membership for authenticated callers.

-- ---------------------------------------------------------------------------
-- 1. apply_profile_amendment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_profile_amendment(
  p_profile_id      UUID,
  p_amendment_type  TEXT,
  p_target_path     TEXT,
  p_after           JSONB,
  p_reason          TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_profile    project_profiles%ROWTYPE;
  v_before     JSONB;
  v_path_parts TEXT[];
BEGIN
  SELECT * INTO v_profile FROM project_profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile_not_found: %', p_profile_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_profile.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden: caller is not a member of profile organisation'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF p_amendment_type = 'update_goal_text' THEN
    v_before := jsonb_build_object('goal_text', v_profile.goal_text);
    UPDATE project_profiles
    SET goal_text  = p_after #>> '{}',
        updated_at = NOW()
    WHERE id = p_profile_id;

    INSERT INTO profile_amendments (
      profile_id, proposed_by, amendment_type, target_path, before, after, approved_by_user_id, reason
    ) VALUES (
      p_profile_id, 'director', p_amendment_type, p_target_path, v_before, p_after, v_caller, p_reason
    );

  ELSE
    IF p_target_path IS NULL OR p_target_path NOT LIKE 'preferences.%' THEN
      RAISE EXCEPTION 'invalid_target_path: expected preferences.<key>, got %', p_target_path
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    v_path_parts := string_to_array(substring(p_target_path FROM 13), '.');

    v_before := jsonb_build_object(
      'preferences', v_profile.preferences,
      'at', v_profile.preferences #> v_path_parts
    );

    UPDATE project_profiles
    SET preferences = jsonb_set(preferences, v_path_parts, p_after, TRUE),
        updated_at  = NOW()
    WHERE id = p_profile_id;

    INSERT INTO profile_amendments (
      profile_id, proposed_by, amendment_type, target_path, before, after, approved_by_user_id, reason
    ) VALUES (
      p_profile_id, 'director', p_amendment_type, p_target_path, v_before, p_after, v_caller, p_reason
    );
  END IF;

  RETURN (SELECT row_to_json(p) FROM project_profiles p WHERE p.id = p_profile_id);
END;
$$;

REVOKE ALL ON FUNCTION apply_profile_amendment(UUID, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_profile_amendment(UUID, TEXT, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_profile_amendment(UUID, TEXT, TEXT, JSONB, TEXT) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. accept_brief — atomic Brief creation from a user-approved proposal.
-- ---------------------------------------------------------------------------
--
-- p_stages is a JSONB array of stage shapes:
--   { order, title, description, trigger_type, trigger_config }
--
-- The first-stage workflow is NOT created by this RPC. The approval API
-- route creates the workflow + workflow_steps separately (using existing
-- Phase 5b RPCs) and updates brief_stages.workflow_id for stage 1.
-- This keeps accept_brief focused on Brief shape and avoids coupling to
-- workflow creation internals.

CREATE OR REPLACE FUNCTION accept_brief(
  p_document_id     UUID,
  p_goal_text       TEXT,
  p_stages          JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller       UUID := auth.uid();
  v_doc          documents%ROWTYPE;
  v_brief_id     UUID := gen_random_uuid();
  v_first_stage_id UUID;
  v_stage        JSONB;
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

  -- V1.x-A.1 one-Brief-at-a-time enforcement is at the partial unique
  -- index level. If another planned/active Brief exists for this
  -- document, the INSERT below will fail with unique_violation; surface
  -- a cleaner error code first for the API route to map.
  IF EXISTS (
    SELECT 1 FROM briefs
    WHERE document_id = p_document_id AND status IN ('planned','active')
  ) THEN
    RAISE EXCEPTION 'another_brief_active: cancel the existing Brief first'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO briefs (
    id, document_id, organisation_id, goal_text, status, approved_at, started_at
  ) VALUES (
    v_brief_id, p_document_id, v_doc.organisation_id, p_goal_text, 'active', NOW(), NOW()
  );

  FOR v_stage IN SELECT jsonb_array_elements(p_stages)
  LOOP
    INSERT INTO brief_stages (
      brief_id, "order", title, description, trigger_type, trigger_config, status
    ) VALUES (
      v_brief_id,
      (v_stage->>'order')::INTEGER,
      v_stage->>'title',
      v_stage->>'description',
      v_stage->>'trigger_type',
      COALESCE(v_stage->'trigger_config', '{}'::jsonb),
      'planned'
    );
  END LOOP;

  SELECT id INTO v_first_stage_id
  FROM brief_stages WHERE brief_id = v_brief_id ORDER BY "order" ASC LIMIT 1;

  UPDATE briefs SET current_stage_id = v_first_stage_id WHERE id = v_brief_id;

  RETURN jsonb_build_object(
    'brief',  (SELECT row_to_json(b) FROM briefs b WHERE b.id = v_brief_id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order") FROM brief_stages s WHERE s.brief_id = v_brief_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION accept_brief(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. complete_brief_stage — stage finished; advance Brief state.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION complete_brief_stage(
  p_stage_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller     UUID := auth.uid();
  v_stage      brief_stages%ROWTYPE;
  v_brief      briefs%ROWTYPE;
  v_next_stage_id UUID;
BEGIN
  SELECT * INTO v_stage FROM brief_stages WHERE id = p_stage_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stage_not_found: %', p_stage_id USING ERRCODE = 'no_data_found';
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

  UPDATE brief_stages
  SET status = 'completed', completed_at = NOW()
  WHERE id = p_stage_id;

  SELECT id INTO v_next_stage_id
  FROM brief_stages
  WHERE brief_id = v_stage.brief_id AND "order" > v_stage."order"
  ORDER BY "order" ASC
  LIMIT 1;

  IF v_next_stage_id IS NOT NULL THEN
    UPDATE briefs SET current_stage_id = v_next_stage_id WHERE id = v_stage.brief_id;
  ELSE
    -- Last stage completed — mark Brief completed.
    UPDATE briefs
    SET status = 'completed', completed_at = NOW(), current_stage_id = NULL
    WHERE id = v_stage.brief_id;
  END IF;

  RETURN jsonb_build_object(
    'brief',  (SELECT row_to_json(b) FROM briefs b WHERE b.id = v_stage.brief_id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order") FROM brief_stages s WHERE s.brief_id = v_stage.brief_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION complete_brief_stage(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION complete_brief_stage(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION complete_brief_stage(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. cancel_brief — cancel an active or planned Brief.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION cancel_brief(
  p_brief_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_brief  briefs%ROWTYPE;
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

  IF v_brief.status NOT IN ('planned','active') THEN
    RAISE EXCEPTION 'invalid_status: cannot cancel brief in status %', v_brief.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE briefs
  SET status = 'cancelled', cancelled_at = NOW(), current_stage_id = NULL
  WHERE id = p_brief_id;

  RETURN (SELECT row_to_json(b) FROM briefs b WHERE b.id = p_brief_id);
END;
$$;

REVOKE ALL ON FUNCTION cancel_brief(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_brief(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION cancel_brief(UUID) TO service_role;
