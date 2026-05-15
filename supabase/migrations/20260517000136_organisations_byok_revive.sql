-- V1.x-C.3 — revive organisations.byok_* columns for per-org BYOK.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.3 M-136.
--
-- The M-001 organisations.byok_enabled / byok_provider / byok_api_key_vault_id
-- columns have been in the schema since Phase 1 but unused until now. V1.x-B.1.2
-- shipped per-user BYOK via user_anthropic_keys; V1.x-C.3 retargets to per-org
-- per Option A (Director Architecture v2 §15).
--
-- This migration:
--   1. Adds last_four + last_validated_at columns to organisations (mirrors
--      the per-user table shape).
--   2. Adds the enable_org_byok / disable_org_byok SECURITY DEFINER RPCs
--      that gate the byok_enabled flag on plan eligibility.
--
-- BYOK-eligible plans (locked 2026-05-17 with user): byok_solo + byok_team
-- only. The other locked plan slugs (trial / writer / author / pro) cannot
-- enable BYOK; an org must switch its plan via the subscription flow before
-- enabling BYOK (V2 Stripe pass).
--
-- H-13: SET search_path = public on every SECURITY DEFINER body.

ALTER TABLE organisations
  ADD COLUMN byok_api_key_last_four CHAR(4) NULL,
  ADD COLUMN byok_api_key_last_validated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN organisations.byok_api_key_last_four IS
  'V1.x-C.3 — last 4 chars of the org BYOK Anthropic API key. Stored unencrypted for "is this the right key?" UX confirmation (matches per-user M-103 pattern). Cleared on delete.';

COMMENT ON COLUMN organisations.byok_api_key_last_validated_at IS
  'V1.x-C.3 — timestamp of the last successful Anthropic validation call for the org BYOK key. Used by the AnthropicKeyPanel UI to surface "Validated N hours ago".';

-- ---------------------------------------------------------------------------
-- enable_org_byok — gate the byok_enabled flag on plan eligibility.
-- ---------------------------------------------------------------------------
-- An admin / owner of an org with a BYOK-eligible plan can call this to
-- flip byok_enabled=TRUE. Idempotent on repeat calls. Returns the resulting
-- state for the UI to confirm.
--
-- Note: enabling BYOK without a key is allowed (the org can pre-enable
-- before any admin uploads the key); the factory's precedence layer
-- (V1.x-C.3) checks BOTH byok_enabled AND key presence before routing.

CREATE OR REPLACE FUNCTION enable_org_byok(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_plan      TEXT;
  v_role      TEXT;
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

  -- Plan eligibility: BYOK is reserved for byok_solo + byok_team.
  SELECT plan INTO v_plan FROM organisations WHERE id = p_org_id;
  IF v_plan IS NULL THEN
    RAISE EXCEPTION 'org_not_found' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_plan NOT IN ('byok_solo', 'byok_team') THEN
    RAISE EXCEPTION 'plan_not_byok_eligible: %', v_plan USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE organisations
  SET byok_enabled = TRUE
  WHERE id = p_org_id;

  RETURN jsonb_build_object(
    'byok_enabled', TRUE,
    'plan',         v_plan
  );
END;
$$;

REVOKE ALL ON FUNCTION enable_org_byok(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enable_org_byok(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION enable_org_byok(UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- disable_org_byok — admin can pause BYOK without deleting the key. Useful
-- if the org's Anthropic account is over-quota and they want to temporarily
-- bounce back to platform routing without a delete + re-upload round-trip.
-- (V1 ships the symmetry; whether the UI exposes it is C.3 UI decision.)

CREATE OR REPLACE FUNCTION disable_org_byok(p_org_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_role   TEXT;
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

  UPDATE organisations
  SET byok_enabled = FALSE
  WHERE id = p_org_id;

  RETURN jsonb_build_object('byok_enabled', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION disable_org_byok(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION disable_org_byok(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION disable_org_byok(UUID) TO service_role;
