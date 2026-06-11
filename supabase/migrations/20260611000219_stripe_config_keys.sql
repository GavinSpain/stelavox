-- M-219 — Stripe platform_config keys (Phase 9.B work package B substrate).
--
-- Background
-- ----------
-- V1.x-C already seeded `price.*` config keys holding cents amounts
-- (writer/author/pro/byok_solo/byok_team monthly + annual discount).
-- Those keys describe the *price the user pays*, not the Stripe artefact
-- ID. To create a Checkout Session against Stripe we need the actual
-- `price_*` IDs from the Stripe dashboard. Storing them in
-- platform_config (not env vars) keeps them auditable and DB-driven and
-- lets us swap test/live without code or deploy.
--
-- Test + live each get their own set; the active set is chosen by
-- `stripe.mode`. The mode-aware reader in lib/stripe/config.ts validates
-- that the active mode's keys are all set before allowing Checkout to
-- fire (returns 503 stripe_not_configured otherwise — see B.3).
--
-- Webhook signing secret follows the same test/live split. Vault would
-- be marginally more secure for the secret but adds plumbing that's not
-- justified for a Stripe-test-mode launch; the secret rotates via
-- Stripe Dashboard + a single platform_config UPDATE.
--
-- Stripe API keys (sk_test_* / sk_live_*) stay in env vars (Vercel +
-- .env.local) because they're the auth credential and need to follow
-- standard env-var hygiene.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  -- Mode selector
  ('stripe.mode', '"test"',
   'Active Stripe mode: "test" or "live". The mode determines which set of price IDs and webhook secret the system reads. Swap to "live" at launch via this key (no deploy required).',
   'string'),

  -- Test-mode Price IDs (created in Stripe test mode dashboard)
  ('stripe.test.price_id.writer_monthly', '""',
   'Stripe Price ID (price_*) for the writer plan, monthly cadence, test mode. Empty string until the Stripe test account is provisioned + the Product+Price are created. Checkout against an empty price ID returns 503 stripe_not_configured.',
   'string'),
  ('stripe.test.price_id.author_monthly', '""',
   'Stripe Price ID for the author plan, monthly cadence, test mode.',
   'string'),
  ('stripe.test.price_id.pro_monthly', '""',
   'Stripe Price ID for the pro plan, monthly cadence, test mode.',
   'string'),
  ('stripe.test.price_id.byok_solo_monthly', '""',
   'Stripe Price ID for the byok_solo plan ($15/month platform fee, BYOK pays own LLM costs), monthly cadence, test mode.',
   'string'),

  -- Live-mode Price IDs (created in Stripe live mode dashboard)
  ('stripe.live.price_id.writer_monthly', '""',
   'Stripe Price ID for the writer plan, monthly cadence, live mode. Populated at launch when the live Stripe account is provisioned.',
   'string'),
  ('stripe.live.price_id.author_monthly', '""',
   'Stripe Price ID for the author plan, monthly cadence, live mode.',
   'string'),
  ('stripe.live.price_id.pro_monthly', '""',
   'Stripe Price ID for the pro plan, monthly cadence, live mode.',
   'string'),
  ('stripe.live.price_id.byok_solo_monthly', '""',
   'Stripe Price ID for the byok_solo plan, monthly cadence, live mode.',
   'string'),

  -- Webhook signing secrets (one per mode)
  ('stripe.webhook_secret_test', '""',
   'Stripe webhook signing secret (whsec_*) for test mode. Copied from the Stripe dashboard webhook endpoint configuration. Used by /api/stripe/webhook to verify signature.',
   'string'),
  ('stripe.webhook_secret_live', '""',
   'Stripe webhook signing secret for live mode.',
   'string')
ON CONFLICT (key) DO NOTHING;
