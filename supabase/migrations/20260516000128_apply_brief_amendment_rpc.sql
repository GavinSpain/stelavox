-- Migration 128 — V1.x-B.3: apply_brief_amendment RPC + accept_brief revised.
--
-- Source: stelavox_v1x_b_3_build_checklist_v1_0.md §2 M-128.
--
-- Two parts:
--
-- 1. apply_brief_amendment(p_amendment_id) — applies an APPROVED amendment
--    to its parent Brief atomically. amendment_type discriminates:
--      'goal_text'              — UPDATE briefs.goal_text
--      'preferences'            — UPDATE briefs.preferences (deep merge)
--      'add_stage'              — INSERT brief_stages
--      'modify_pending_stage'   — UPDATE brief_stages WHERE status='planned'
--      'remove_pending_stage'   — DELETE brief_stages WHERE status='planned'
--    Refuses to modify already-running stages (status<>'planned').
--    Idempotent: amendment.status='approved' guard ensures double-apply
--    is a no-op (returns the prior result).
--    Marks amendment.status='applied' on success — wait, no: status enum is
--    proposed/approved/rejected. We use a separate `applied_at TIMESTAMPTZ`
--    column for the apply timestamp (added below).
--
-- 2. accept_brief revised — drops the V1.x-B.1.1 `another_brief_active`
--    queue path. New behaviour: every accept_brief INSERTs a status='active'
--    row regardless of whether other active Briefs exist on the document.
--    The 'queued' status remains in the CHECK constraint for backwards
--    compatibility but no new code path produces queued rows.

-- Add applied_at column to brief_amendments (V1.x-B.3 close-out tweak).
ALTER TABLE brief_amendments
  ADD COLUMN applied_at TIMESTAMPTZ NULL;

-- ---------------------------------------------------------------------------
-- 1. apply_brief_amendment
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION apply_brief_amendment(
  p_amendment_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller         UUID := auth.uid();
  v_amend          brief_amendments%ROWTYPE;
  v_brief          briefs%ROWTYPE;
  v_target_stage   brief_stages%ROWTYPE;
  v_new_stage_id   UUID;
  v_existing_stages_count INTEGER;
  v_pending_stages_count INTEGER;
BEGIN
  SELECT * INTO v_amend FROM brief_amendments WHERE id = p_amendment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'amendment_not_found: %', p_amendment_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_amend.status <> 'approved' THEN
    RAISE EXCEPTION 'amendment_not_approved: status is %', v_amend.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotent: already applied → return current state.
  IF v_amend.applied_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'amendment_id', p_amendment_id,
      'already_applied', true,
      'applied_at', v_amend.applied_at
    );
  END IF;

  SELECT * INTO v_brief FROM briefs WHERE id = v_amend.brief_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'brief_not_found: %', v_amend.brief_id USING ERRCODE = 'no_data_found';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM organisation_members
      WHERE user_id = v_caller AND organisation_id = v_brief.organisation_id
    ) THEN
      RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Apply by amendment_type.
  CASE v_amend.amendment_type
    WHEN 'goal_text' THEN
      UPDATE briefs SET goal_text = v_amend.after->>'goal_text' WHERE id = v_brief.id;

    WHEN 'preferences' THEN
      -- Deep merge: existing || amendment after-shape.
      UPDATE briefs
      SET preferences = COALESCE(preferences, '{}'::jsonb) || v_amend.after
      WHERE id = v_brief.id;

    WHEN 'add_stage' THEN
      INSERT INTO brief_stages (
        brief_id, "order", title, description, trigger_type, trigger_config, status
      ) VALUES (
        v_brief.id,
        (v_amend.after->>'order')::INTEGER,
        v_amend.after->>'title',
        v_amend.after->>'description',
        COALESCE(v_amend.after->>'trigger_type', 'manual'),
        COALESCE(v_amend.after->'trigger_config', '{}'::jsonb),
        'planned'
      ) RETURNING id INTO v_new_stage_id;

    WHEN 'modify_pending_stage' THEN
      SELECT * INTO v_target_stage
      FROM brief_stages
      WHERE id = (v_amend.target_path)::UUID AND brief_id = v_brief.id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'target_stage_not_found' USING ERRCODE = 'no_data_found';
      END IF;
      IF v_target_stage.status <> 'planned' THEN
        RAISE EXCEPTION 'cannot_modify_non_pending_stage: status is %', v_target_stage.status
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      UPDATE brief_stages SET
        title         = COALESCE(v_amend.after->>'title', title),
        description   = COALESCE(v_amend.after->>'description', description),
        trigger_type  = COALESCE(v_amend.after->>'trigger_type', trigger_type),
        trigger_config = COALESCE(v_amend.after->'trigger_config', trigger_config)
      WHERE id = v_target_stage.id;

    WHEN 'remove_pending_stage' THEN
      SELECT * INTO v_target_stage
      FROM brief_stages
      WHERE id = (v_amend.target_path)::UUID AND brief_id = v_brief.id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'target_stage_not_found' USING ERRCODE = 'no_data_found';
      END IF;
      IF v_target_stage.status <> 'planned' THEN
        RAISE EXCEPTION 'cannot_remove_non_pending_stage: status is %', v_target_stage.status
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      -- Defensive: refuse if removing this stage would leave zero pending stages.
      SELECT COUNT(*) INTO v_pending_stages_count
      FROM brief_stages
      WHERE brief_id = v_brief.id AND status = 'planned';
      IF v_pending_stages_count <= 1 THEN
        RAISE EXCEPTION 'cannot_remove_last_pending_stage'
          USING ERRCODE = 'invalid_parameter_value';
      END IF;

      DELETE FROM brief_stages WHERE id = v_target_stage.id;

    ELSE
      RAISE EXCEPTION 'unknown_amendment_type: %', v_amend.amendment_type
        USING ERRCODE = 'invalid_parameter_value';
  END CASE;

  -- Mark amendment applied.
  UPDATE brief_amendments
  SET applied_at = NOW()
  WHERE id = p_amendment_id;

  -- Surface system event for the amendment so the Director sees it on next turn.
  PERFORM _emit_system_event(
    v_brief.document_id,
    'brief_amended',
    jsonb_build_object(
      'amendment_id', p_amendment_id,
      'brief_id',     v_brief.id,
      'amendment_type', v_amend.amendment_type
    ),
    'user_amendment',
    format('Brief amended: %s', v_amend.amendment_type)
  );

  RETURN jsonb_build_object(
    'amendment_id', p_amendment_id,
    'applied_at', NOW(),
    'brief', (SELECT row_to_json(b) FROM briefs b WHERE b.id = v_brief.id),
    'stages', (SELECT jsonb_agg(row_to_json(s) ORDER BY s."order") FROM brief_stages s WHERE s.brief_id = v_brief.id)
  );

  -- Suppress unused variable warning.
  RETURN jsonb_build_object('unused', v_existing_stages_count);
END;
$$;

REVOKE ALL ON FUNCTION apply_brief_amendment(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_brief_amendment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION apply_brief_amendment(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. accept_brief revised — drop another_brief_active queue path
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION accept_brief(
  p_document_id UUID,
  p_goal_text   TEXT,
  p_stages      JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- V1.x-B.3 — concurrent multi-Brief. No queue path. Always activate.
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

  -- current_stage_id always set in V1.x-B.3 (Brief is always active).
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
$$;

REVOKE ALL ON FUNCTION accept_brief(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION accept_brief(UUID, TEXT, JSONB) TO service_role;
