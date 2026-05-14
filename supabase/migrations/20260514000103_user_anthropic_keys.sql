-- Migration 103 — V1.x-B.1.2: user_anthropic_keys table.
-- Source: stelavox_v1x_b_1_2_build_checklist_v1_0.md §3.1 T-1.1
--         + V1.x-B design session record §9 + H-09 (TA v2.3.3 §5).
--
-- Per-user BYOK Anthropic API keys, encrypted at rest via Supabase Vault.
-- Single key per user in V1 (UNIQUE on user_id). H-09 invariant: the
-- decrypted key never materialises outside the BYOK Edge Function memory
-- (M-104's get_user_anthropic_key_for_byok_call RPC is the only caller
-- of vault.decrypted_secrets for this column; the RPC is service-role
-- only and the Edge Function is the only intended invoker).
--
-- last_four is stored unencrypted for "is this the right key?" UX
-- confirmation (matches typical SaaS pattern; not security-relevant —
-- 4 chars of an Anthropic key are not enough to reverse).
--
-- Existing per-org BYOK columns (organisations.byok_enabled,
-- byok_provider, byok_api_key_vault_id) are left in place but unused
-- in V1 — V2 deprecation candidate per the design session record §9.

CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE TABLE user_anthropic_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vault_secret_id UUID NOT NULL,  -- references vault.secrets(id); FK not enforced (Vault is its own schema)
  last_four CHAR(4) NOT NULL,
  last_validated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)  -- single key per user in V1; multiple keys is V2 candidate
);

CREATE INDEX idx_user_anthropic_keys_user_id ON user_anthropic_keys(user_id);

ALTER TABLE user_anthropic_keys ENABLE ROW LEVEL SECURITY;

-- Users can SELECT only their own row. Writes are restricted to
-- the SECURITY DEFINER RPCs in M-104 (no FOR INSERT / UPDATE / DELETE
-- policy = no direct user write access).
CREATE POLICY "users_read_own_anthropic_key" ON user_anthropic_keys
  FOR SELECT USING (auth.uid() = user_id);

-- No realtime publication: changes don't need to push to other clients;
-- user owns their key, single device or refresh on next page load.
