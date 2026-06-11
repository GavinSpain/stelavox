-- M-222 — Stripe yearly Price ID slots (Phase 9.B follow-up: yearly cadence).
--
-- M-219 seeded monthly Price IDs for the 4 V1 subscribable plans across
-- both modes. This migration adds the parallel yearly slots so the
-- PlanPanel cadence toggle can offer "Monthly · Annual (save 20%)".
--
-- Allocation behaviour locked 2026-06-11: credits reset PER MONTH
-- regardless of cadence. The existing rollover_org_periods() pg_cron job
-- (M-141) reads `plan.period_length_days = 30` and is unchanged. Annual
-- subscribers get monthly credit refreshes — only the Stripe billing
-- cycle is annual.
--
-- The discount (20%) lives in price.annual_discount_percent — Stripe
-- holds the actual yearly price; this DB value is for UI display only.

INSERT INTO platform_config (key, value, description, value_type) VALUES
  -- Test-mode yearly Price IDs (created in Stripe test mode dashboard)
  ('stripe.test.price_id.writer_yearly', '""',
   'Stripe Price ID for the writer plan, yearly cadence, test mode. Empty string until the Stripe test account is provisioned + the yearly Price is created (Stripe-side a separate Price row on the same Product as the monthly Price).',
   'string'),
  ('stripe.test.price_id.author_yearly', '""',
   'Stripe Price ID for the author plan, yearly cadence, test mode.',
   'string'),
  ('stripe.test.price_id.pro_yearly', '""',
   'Stripe Price ID for the pro plan, yearly cadence, test mode.',
   'string'),
  ('stripe.test.price_id.byok_solo_yearly', '""',
   'Stripe Price ID for the byok_solo plan, yearly cadence, test mode.',
   'string'),

  -- Live-mode yearly Price IDs (created in Stripe live mode dashboard)
  ('stripe.live.price_id.writer_yearly', '""',
   'Stripe Price ID for the writer plan, yearly cadence, live mode.',
   'string'),
  ('stripe.live.price_id.author_yearly', '""',
   'Stripe Price ID for the author plan, yearly cadence, live mode.',
   'string'),
  ('stripe.live.price_id.pro_yearly', '""',
   'Stripe Price ID for the pro plan, yearly cadence, live mode.',
   'string'),
  ('stripe.live.price_id.byok_solo_yearly', '""',
   'Stripe Price ID for the byok_solo plan, yearly cadence, live mode.',
   'string')
ON CONFLICT (key) DO NOTHING;
