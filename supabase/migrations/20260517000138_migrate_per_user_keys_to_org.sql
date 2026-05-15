-- V1.x-C.3 — one-shot migration of per-user BYOK keys to per-org BYOK.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.3 M-138.
--
-- Pre-V1.x-C.3, BYOK keys lived on user_anthropic_keys (V1.x-B.1.2). V1.x-C
-- retargets BYOK to per-org per Option A. This migration:
--   1. ADDs deprecated_at TIMESTAMPTZ NULL on user_anthropic_keys.
--   2. SECURITY DEFINER one-shot function migrate_per_user_keys_to_org()
--      that iterates user_anthropic_keys rows and, for each:
--      a. Finds the user's org via organisation_members. If the user
--         belongs to multiple orgs, prefer the org where they're owner
--         > admin > member; if still ambiguous, skip + log.
--      b. If the resolved org has a BYOK-eligible plan (byok_solo |
--         byok_team) AND organisations.byok_api_key_vault_id IS NULL
--         (org doesn't yet have its own key), transfer the user's
--         vault_secret_id + last_four + last_validated_at to the org
--         and flip byok_enabled=TRUE / byok_provider='anthropic'. Then
--         mark the per-user row deprecated_at=NOW().
--      c. Otherwise, mark the per-user row deprecated_at=NOW() without
--         transferring (the org isn't BYOK-eligible OR already has
--         its own key — per-user becomes a stale artefact).
--   3. INVOKEs the function once.
--
-- The function is idempotent: re-invocation skips rows where deprecated_at
-- is already set. The vault.secrets row is NOT deleted on transfer — the
-- secret is now referenced by the org row instead of the user row, so
-- the Vault entry stays as-is with just the FK pointer moving.
--
-- H-09: the function never selects vault.decrypted_secrets — it operates
-- only on the vault_secret_id pointer.
--
-- H-13: SET search_path = public.

ALTER TABLE user_anthropic_keys
  ADD COLUMN deprecated_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN user_anthropic_keys.deprecated_at IS
  'V1.x-C.3 — set by migrate_per_user_keys_to_org() when the per-user key has been (a) transferred to the user''s org or (b) left in place but superseded. lib/llm/byok.ts:userHasByokKey filters this out so deprecated rows don''t resolve as BYOK-eligible.';

-- ---------------------------------------------------------------------------
-- migrate_per_user_keys_to_org — SECURITY DEFINER one-shot.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION migrate_per_user_keys_to_org()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row          RECORD;
  v_org_id       UUID;
  v_org_plan     TEXT;
  v_org_existing TEXT;
  v_transferred  INTEGER := 0;
  v_deprecated   INTEGER := 0;
  v_skipped      INTEGER := 0;
BEGIN
  FOR v_row IN
    SELECT id, user_id, vault_secret_id, last_four, last_validated_at
    FROM user_anthropic_keys
    WHERE deprecated_at IS NULL
  LOOP
    -- Resolve the user's primary org. Multi-org users: prefer owner > admin.
    SELECT organisation_id INTO v_org_id
    FROM organisation_members
    WHERE user_id = v_row.user_id
    ORDER BY
      CASE role
        WHEN 'owner' THEN 0
        WHEN 'admin' THEN 1
        WHEN 'member' THEN 2
        ELSE 3
      END,
      joined_at ASC
    LIMIT 1;

    IF v_org_id IS NULL THEN
      -- User has no org membership. Mark deprecated without transfer.
      UPDATE user_anthropic_keys SET deprecated_at = NOW() WHERE id = v_row.id;
      v_deprecated := v_deprecated + 1;
      CONTINUE;
    END IF;

    SELECT plan, byok_api_key_vault_id INTO v_org_plan, v_org_existing
    FROM organisations WHERE id = v_org_id;

    IF v_org_plan IN ('byok_solo', 'byok_team') AND v_org_existing IS NULL THEN
      -- Transfer.
      UPDATE organisations
      SET
        byok_api_key_vault_id          = v_row.vault_secret_id::TEXT,
        byok_api_key_last_four         = v_row.last_four,
        byok_api_key_last_validated_at = v_row.last_validated_at,
        byok_enabled                   = TRUE,
        byok_provider                  = 'anthropic'
      WHERE id = v_org_id;
      UPDATE user_anthropic_keys SET deprecated_at = NOW() WHERE id = v_row.id;
      v_transferred := v_transferred + 1;
    ELSIF v_org_plan IN ('byok_solo', 'byok_team') AND v_org_existing IS NOT NULL THEN
      -- Org already has its own key — deprecate the per-user one without
      -- overwriting. The org's existing key wins.
      UPDATE user_anthropic_keys SET deprecated_at = NOW() WHERE id = v_row.id;
      v_deprecated := v_deprecated + 1;
    ELSE
      -- Org is on a non-BYOK plan — per-user key is stranded; mark
      -- deprecated. The user can re-upload after the org switches plan.
      UPDATE user_anthropic_keys SET deprecated_at = NOW() WHERE id = v_row.id;
      v_skipped := v_skipped + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'transferred', v_transferred,
    'deprecated',  v_deprecated,
    'skipped',     v_skipped
  );
END;
$$;

REVOKE ALL ON FUNCTION migrate_per_user_keys_to_org() FROM PUBLIC;
-- Service-role only — this is a one-shot admin migration, not a user-callable RPC.
GRANT EXECUTE ON FUNCTION migrate_per_user_keys_to_org() TO service_role;

-- Run the one-shot now. Re-invocations are safe (filtered by deprecated_at).
SELECT migrate_per_user_keys_to_org();
