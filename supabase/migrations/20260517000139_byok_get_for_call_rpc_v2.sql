-- V1.x-C.3 — get_org_anthropic_key_for_byok_call (service-role only).
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.3 M-139.
--
-- Mirrors M-104's get_user_anthropic_key_for_byok_call but keyed on
-- org_id. The BYOK Edge Function (supabase/functions/byok-llm-call/) is
-- the only intended caller. Per H-09 the decrypted key must never reach
-- a Next.js API route — service-role-only GRANT enforces that.
--
-- The Edge Function accepts EITHER x-stelavox-user-id (legacy V1.x-B.1.2
-- path) OR x-stelavox-org-id (V1.x-C.3 path) and picks the appropriate
-- RPC to call.
--
-- H-13: SET search_path = public.

CREATE OR REPLACE FUNCTION get_org_anthropic_key_for_byok_call(p_org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vault_id TEXT;
  v_enabled  BOOLEAN;
  v_decrypted TEXT;
BEGIN
  SELECT byok_api_key_vault_id, byok_enabled
  INTO v_vault_id, v_enabled
  FROM organisations WHERE id = p_org_id;

  IF v_vault_id IS NULL OR NOT v_enabled THEN
    RAISE EXCEPTION 'no_byok_key_for_org' USING ERRCODE = 'no_data_found';
  END IF;

  SELECT decrypted_secret INTO v_decrypted
  FROM vault.decrypted_secrets
  WHERE id = v_vault_id::UUID;

  IF v_decrypted IS NULL THEN
    RAISE EXCEPTION 'vault_decrypt_failed' USING ERRCODE = 'data_exception';
  END IF;

  RETURN v_decrypted;
END;
$$;

REVOKE ALL ON FUNCTION get_org_anthropic_key_for_byok_call(UUID) FROM PUBLIC;
-- INTENTIONALLY NO GRANT to authenticated — service-role only (H-09).
GRANT EXECUTE ON FUNCTION get_org_anthropic_key_for_byok_call(UUID) TO service_role;
