-- Migration 104 — V1.x-B.1.2: SECURITY DEFINER RPCs for user_anthropic_keys.
-- Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.1 T-1.2.
--
-- Four RPCs:
--   1. save_user_anthropic_key(p_key, p_validation_completed_at) —
--      authenticated; INSERTs into vault.secrets + UPSERTs the
--      user_anthropic_keys row keyed on auth.uid(); deletes prior Vault
--      secret if replacing. Returns metadata (no key value).
--
--   2. get_user_anthropic_key_status() — authenticated; returns
--      {present, last_four?, last_validated_at?}. Never returns the key.
--
--   3. get_user_anthropic_key_for_byok_call(p_user_id) — service-role
--      ONLY. Returns the decrypted key from vault.decrypted_secrets.
--      The BYOK Edge Function (supabase/functions/byok-llm-call/) is
--      the only intended caller. Per H-09 the response value never
--      reaches Next.js API routes.
--
--   4. delete_user_anthropic_key() — authenticated; deletes the user's
--      row + the corresponding vault.secrets row.
--
-- All RPCs include SET search_path = public per H-13.

-- ---------------------------------------------------------------------------
-- 1. save_user_anthropic_key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION save_user_anthropic_key(
  p_key TEXT,
  p_validation_completed_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_existing_secret UUID;
  v_new_secret      UUID;
  v_last_four       CHAR(4);
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_key IS NULL OR length(p_key) < 8 THEN
    RAISE EXCEPTION 'invalid_key: too short' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_last_four := right(p_key, 4);

  -- Find any existing key for this user; capture vault_secret_id so we
  -- can delete the old Vault secret after the UPSERT.
  SELECT vault_secret_id INTO v_existing_secret
  FROM user_anthropic_keys
  WHERE user_id = v_caller;

  -- Insert the new secret into Vault.
  v_new_secret := vault.create_secret(
    p_key,
    'user_anthropic_key:' || v_caller::TEXT || ':' || extract(epoch from now())::TEXT,
    'V1.x-B.1.2 BYOK key for user ' || v_caller::TEXT
  );

  -- UPSERT the user_anthropic_keys row.
  INSERT INTO user_anthropic_keys (
    user_id, vault_secret_id, last_four, last_validated_at
  ) VALUES (
    v_caller, v_new_secret, v_last_four, p_validation_completed_at
  )
  ON CONFLICT (user_id) DO UPDATE SET
    vault_secret_id   = EXCLUDED.vault_secret_id,
    last_four         = EXCLUDED.last_four,
    last_validated_at = EXCLUDED.last_validated_at;

  -- Delete the old Vault secret (after the UPSERT so we never lose access
  -- to a working key mid-replace).
  IF v_existing_secret IS NOT NULL AND v_existing_secret <> v_new_secret THEN
    DELETE FROM vault.secrets WHERE id = v_existing_secret;
  END IF;

  RETURN jsonb_build_object(
    'present',           true,
    'last_four',         v_last_four,
    'last_validated_at', p_validation_completed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION save_user_anthropic_key(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_user_anthropic_key(TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION save_user_anthropic_key(TEXT, TIMESTAMPTZ) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. get_user_anthropic_key_status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_user_anthropic_key_status()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_row    user_anthropic_keys%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_row FROM user_anthropic_keys WHERE user_id = v_caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('present', false);
  END IF;

  RETURN jsonb_build_object(
    'present',           true,
    'last_four',         v_row.last_four,
    'last_validated_at', v_row.last_validated_at
  );
END;
$$;

REVOKE ALL ON FUNCTION get_user_anthropic_key_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_anthropic_key_status() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_anthropic_key_status() TO service_role;

-- ---------------------------------------------------------------------------
-- 3. get_user_anthropic_key_for_byok_call — SERVICE-ROLE ONLY
-- ---------------------------------------------------------------------------
-- Returns the decrypted key. The BYOK Edge Function is the only intended
-- caller. Per H-09 the response value must never reach Next.js API routes.
-- No GRANT to authenticated.

CREATE OR REPLACE FUNCTION get_user_anthropic_key_for_byok_call(
  p_user_id UUID
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_secret_id UUID;
  v_decrypted TEXT;
BEGIN
  SELECT vault_secret_id INTO v_secret_id
  FROM user_anthropic_keys
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_byok_key_for_user' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT decrypted_secret INTO v_decrypted
  FROM vault.decrypted_secrets
  WHERE id = v_secret_id;

  IF v_decrypted IS NULL THEN
    RAISE EXCEPTION 'vault_decrypt_failed' USING ERRCODE = 'data_exception';
  END IF;

  RETURN v_decrypted;
END;
$$;

REVOKE ALL ON FUNCTION get_user_anthropic_key_for_byok_call(UUID) FROM PUBLIC;
-- INTENTIONALLY NO GRANT to authenticated — service-role only.
GRANT EXECUTE ON FUNCTION get_user_anthropic_key_for_byok_call(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. delete_user_anthropic_key
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION delete_user_anthropic_key()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_secret_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT vault_secret_id INTO v_secret_id
  FROM user_anthropic_keys
  WHERE user_id = v_caller;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('deleted', false, 'reason', 'no_key_present');
  END IF;

  DELETE FROM user_anthropic_keys WHERE user_id = v_caller;
  DELETE FROM vault.secrets WHERE id = v_secret_id;

  RETURN jsonb_build_object('deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION delete_user_anthropic_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_user_anthropic_key() TO authenticated;
GRANT EXECUTE ON FUNCTION delete_user_anthropic_key() TO service_role;
