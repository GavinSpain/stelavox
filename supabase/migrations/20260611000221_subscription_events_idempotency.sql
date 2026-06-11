-- M-221 — subscription_events idempotency (Phase 9.B Session 2 webhook handler).
--
-- The Stripe webhook handler at /api/stripe/webhook can be invoked
-- multiple times for the same event (Stripe retries failed deliveries,
-- network blips, etc.). Without a uniqueness guarantee on the event ID
-- the handler could apply the same state change twice.
--
-- Adding a partial unique index on stripe_event_id (where not null)
-- makes the INSERT ... ON CONFLICT DO NOTHING idempotency pattern atomic
-- at the DB layer. The handler runs the per-event side effects only
-- when the INSERT actually wrote a row.
--
-- Existing rows where stripe_event_id IS NULL (legacy/test seed data)
-- are unaffected — the partial predicate skips them.

CREATE UNIQUE INDEX IF NOT EXISTS subscription_events_stripe_event_id_uidx
  ON subscription_events (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

COMMENT ON INDEX subscription_events_stripe_event_id_uidx IS
  'Phase 9.B — idempotency guarantee for /api/stripe/webhook. The handler INSERTs (stripe_event_id, organisation_id, event_type, metadata) ON CONFLICT DO NOTHING; the unique index makes the duplicate-event skip atomic.';
