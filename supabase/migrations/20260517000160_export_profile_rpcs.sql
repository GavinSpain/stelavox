-- Migration 160: SECURITY DEFINER RPCs for export_profiles CRUD
--
-- Phase 7.A — Export Foundation.
--
-- Three RPCs for author-saved profile lifecycle:
--   - save_export_profile(p_project_id, p_name, p_format, p_config)
--   - update_export_profile(p_id, p_name, p_config)
--   - delete_export_profile(p_id)
--
-- All include SET search_path = public per H-13.
-- All enforce membership + is_builtin invariant (cannot edit/delete built-ins).
-- Built-in profile creation happens at migration time (M-159 seeds); the
-- RPCs explicitly refuse is_builtin=TRUE writes from authenticated callers.

-- ─── save_export_profile ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION save_export_profile(
  p_project_id UUID,
  p_name TEXT,
  p_format TEXT,
  p_config JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_org_id UUID;
  v_new_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  SELECT organisation_id INTO v_org_id FROM projects WHERE id = p_project_id;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'not_found: project % does not exist', p_project_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller AND organisation_id = v_org_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_org_id;
  END IF;

  IF p_format NOT IN ('docx', 'epub', 'json', 'outline') THEN
    RAISE EXCEPTION 'invalid_format: %', p_format;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name: empty';
  END IF;

  INSERT INTO export_profiles (
    organisation_id, project_id, name, format, config, is_builtin, created_by_user_id
  ) VALUES (
    v_org_id, p_project_id, p_name, p_format, p_config, FALSE, v_caller
  ) RETURNING id INTO v_new_id;

  RETURN jsonb_build_object('ok', true, 'id', v_new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION save_export_profile(UUID, TEXT, TEXT, JSONB) TO authenticated;

-- ─── update_export_profile ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_export_profile(
  p_id UUID,
  p_name TEXT,
  p_config JSONB
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_profile export_profiles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  SELECT * INTO v_profile FROM export_profiles WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: export_profile % does not exist', p_id;
  END IF;

  IF v_profile.is_builtin THEN
    RAISE EXCEPTION 'forbidden: cannot edit built-in profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller AND organisation_id = v_profile.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_profile.organisation_id;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'invalid_name: empty';
  END IF;

  UPDATE export_profiles SET
    name = p_name,
    config = p_config,
    updated_at = NOW()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION update_export_profile(UUID, TEXT, JSONB) TO authenticated;

-- ─── delete_export_profile ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION delete_export_profile(
  p_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_profile export_profiles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'forbidden: no auth context';
  END IF;

  SELECT * INTO v_profile FROM export_profiles WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_found: export_profile % does not exist', p_id;
  END IF;

  IF v_profile.is_builtin THEN
    RAISE EXCEPTION 'forbidden: cannot delete built-in profile';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM organisation_members
     WHERE user_id = v_caller AND organisation_id = v_profile.organisation_id
  ) THEN
    RAISE EXCEPTION 'forbidden: caller is not a member of organisation %', v_profile.organisation_id;
  END IF;

  DELETE FROM export_profiles WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'id', p_id);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_export_profile(UUID) TO authenticated;
