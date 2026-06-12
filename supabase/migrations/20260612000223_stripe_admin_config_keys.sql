-- M-223 — Stripe admin-config keys (Phase 9.B admin payments follow-up).
--
-- Extracts the only remaining hardcoded payment parameter
-- (`STRIPE_API_VERSION` at lib/stripe/client.ts:17) into a config key
-- so it can be rolled forward at Stripe's recommendation without a
-- deploy. Plus 3 Checkout-behaviour keys that the admin can toggle
-- without code changes (Stripe Tax, promotion codes, billing address
-- collection).
--
-- Defaults preserve current behaviour exactly:
--   stripe.api_version = '2026-05-27.dahlia' (matches the hardcode)
--   stripe.checkout.automatic_tax_enabled = false (off)
--   stripe.checkout.allow_promotion_codes = false (off)
--   stripe.checkout.billing_address_collection = 'auto' (Stripe default)
--
-- Drift-guard: tests/unit/stripe-api-version-no-hardcode.test.ts will
-- assert no `apiVersion: '...'` literal exists in lib/stripe/. The
-- client reads from getConfigString('stripe.api_version') at boot.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  ('stripe.api_version',
   '"2026-05-27.dahlia"',
   'Stripe API version pinned by the SDK client. Roll forward at Stripe''s recommendation without a deploy via this key. lib/stripe/client.ts reads at boot. NEVER set this empty — the SDK will reject.',
   'string'),

  ('stripe.checkout.automatic_tax_enabled',
   'false',
   'Stripe Tax — auto-collects sales tax / VAT based on customer location. Requires billing_address_collection=''required'' + Stripe Tax setup in Dashboard. Off by default.',
   'boolean'),

  ('stripe.checkout.allow_promotion_codes',
   'false',
   'Lets users enter promo codes at Checkout. Off by default — turn on for launch promos. Promo codes themselves are created in Stripe Dashboard → Promotion codes.',
   'boolean'),

  ('stripe.checkout.billing_address_collection',
   '"auto"',
   'Billing address collection mode at Checkout. "auto" (Stripe decides) or "required" (always collect). Must be "required" if automatic_tax_enabled is true.',
   'string')
ON CONFLICT (key) DO NOTHING;
