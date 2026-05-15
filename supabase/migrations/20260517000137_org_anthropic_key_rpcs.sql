-- V1.x-C.3 — per-org Anthropic API key RPCs.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.3 M-137.
--
-- Three SECURITY DEFINER RPCs mirroring the per-user M-104 pattern:
--   1. save_org_anthropic_key(p_org_id, p_key, p_validation_completed_at)
--   2. get_org_anthropic_key_status(p_org_id)
--   3. delete_org_anthropic_key(p_org_id)
--
-- All three require the caller to be owner or admin of the org. Plan
-- eligibility (byok_solo / byok_team only) checked on save, not on
-- read/delete — an org that downgrades plan should still be able to
-- read status + remove their key.
--
-- H-13: SET search_path = public on every body.
-- H-09: get_*_for_byok_call (M-139) is the only path that returns the
-- decrypted key; this file's status/save/delete operations never reveal it.

-- ---------------------------------------------------------------------------
-- save_org_anthropic_key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_org_anthropic_key(
  p_org_id UUID,
  p_key TEXT,
  p_validation_completed_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_role            TEXT;
  v_plan            TEXT;
  v_existing_secret TEXT;
  v_new_secret      UUID;
  v_last_four       CHAR(4);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Caller must be owner or admin of the org.
  SELECT role INTO v_role
  FROM organisation_members
  WHERE organisation_id = p_org_id AND user_id = v_caller;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Plan eligibility.
  SELECT plan, byok_api_key_vault_id INTO v_plan, v_existing_secret
  FROM organisations WHERE id = p_org_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_plan NOT IN ('byok_solo', 'byok_team') THEN
    RAISE EXCEPTION 'plan_not_byok_eligible: %', v_plan USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Sanity-check the key shape.
  IF p_key IS NULL OR length(p_key) < 8 THEN
    RAISE EXCEPTION 'invalid_key: too short' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_last_four := right(p_key, 4);

  -- Insert the new secret into Vault.
  v_new_secret := vault.create_secret(
    p_key,
    'org_anthropic_key:' || p_org_id::TEXT || ':' || extract(epoch from now())::TEXT,
    'V1.x-C.3 BYOK key for organisation ' || p_org_id::TEXT
  );

  -- Update the organisation row. byok_enabled flipped to TRUE
  -- automatically on save — saving a key implies enabling BYOK.
  -- byok_provider stamped to 'anthropic' (the only V1-supported provider).
  UPDATE organisations
  SET
    byok_api_key_vault_id          = v_new_secret::TEXT,
    byok_api_key_last_four         = v_last_four,
    byok_api_key_last_validated_at = p_validation_completed_at,
    byok_enabled                   = TRUE,
    byok_provider                  = 'anthropic'
  WHERE id = p_org_id;

  -- Delete the prior Vault secret after the update (post-UPSERT cleanup;
  -- matches the per-user M-104 pattern so a replace never leaves the
  -- org without a working key mid-call).
  IF v_existing_secret IS NOT NULL AND v_existing_secret <> v_new_secret::TEXT THEN
    BEGIN
      DELETE FROM vault.secrets WHERE id = v_existing_secret::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      -- Defensive: existing column is TEXT (M-001 chose TEXT over UUID);
      -- a malformed value should not block the save. Log via NOTICE.
      RAISE NOTICE 'prior vault_secret_id was not a valid UUID; skipping cleanup';
    END;
  END IF;

  RETURN jsonb_build_object(
    'present',           TRUE,
    'byok_enabled',      TRUE,
    'last_four',         v_last_four,
    'last_validated_at', p_validation_completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION save_org_anthropic_key(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_org_anthropic_key(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION save_org_anthropic_key(UUID, TEXT, TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- get_org_anthropic_key_status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_org_anthropic_key_status(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
  v_row    organisations%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Status visible to all members (read-only); save/delete still admin-only.
  SELECT role INTO v_role
  FROM organisation_members
  WHERE organisation_id = p_org_id AND user_id = v_caller;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not_a_member' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM organisations WHERE id = p_org_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'no_data_found';
  END IF;

  RETURN jsonb_build_object(
    'present',           v_row.byok_api_key_vault_id IS NOT NULL,
    'byok_enabled',      v_row.byok_enabled,
    'plan',              v_row.plan,
    'last_four',         v_row.byok_api_key_last_four,
    'last_validated_at', v_row.byok_api_key_last_validated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION get_org_anthropic_key_status(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_org_anthropic_key_status(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_org_anthropic_key_status(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- delete_org_anthropic_key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_org_anthropic_key(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_role      TEXT;
  v_secret_id TEXT;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO v_role
  FROM organisation_members
  WHERE organisation_id = p_org_id AND user_id = v_caller;
  IF v_role IS NULL OR v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'insufficient_role' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT byok_api_key_vault_id INTO v_secret_id
  FROM organisations WHERE id = p_org_id;

  IF v_secret_id IS NULL THEN
    RETURN jsonb_build_object('deleted', FALSE, 'reason', 'no_key_present');
  END IF;

  UPDATE organisations
  SET
    byok_api_key_vault_id          = NULL,
    byok_api_key_last_four         = NULL,
    byok_api_key_last_validated_at = NULL,
    byok_enabled                   = FALSE
  WHERE id = p_org_id;

  BEGIN
    DELETE FROM vault.secrets WHERE id = v_secret_id::UUID;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE NOTICE 'vault_secret_id was not a valid UUID; row cleanup proceeded without Vault delete';
  END;

  RETURN jsonb_build_object('deleted', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION delete_org_anthropic_key(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_org_anthropic_key(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_org_anthropic_key(UUID) TO service_role;
