-- M-220 — organisations.trial_expires_at + organisations.stripe_price_id +
-- handle_new_user revision (Phase 9.B work package B substrate).
--
-- Background
-- ----------
-- Trial expiry was previously implicit: `subscription_status='trialling'`
-- and `current_period_start + 30 days`. The 30-day duration lived in
-- `billing.trial_duration_days` (M-008) but no column stored the actual
-- expiry timestamp — the calculation happened in TS at /settings/plan
-- read time. Phase 9.B introduces a routing rule ("trial expired →
-- redirect to /settings/plan") that needs a column it can compare against
-- NOW() at every (app)/* request without a config-key lookup per request.
--
-- M-220 adds:
--   * `trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '30 days'`
--   * `stripe_price_id TEXT NULL` — the active subscription's price ID
--     (set by webhook on subscription created / updated; null on trial)
--
-- handle_new_user revision: stamps `trial_expires_at` from
-- `billing.trial_duration_days` at new-org INSERT. Falls back to the
-- column default (30 days from NOW()) if the config key is missing or
-- unparseable — same defensive shape as M-140's allocation backfill.
--
-- Existing orgs (created before this migration) backfill the column from
-- COALESCE(current_period_start, created_at) + billing.trial_duration_days.
-- A trial org created 25 days ago therefore has 5 days remaining; a
-- subscribed org has the column populated but the trial-expiry gate
-- ignores it because `plan != 'trial'`.
--
-- H-13: SET search_path = public preserved on the function.

ALTER TABLE organisations
  ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + interval '30 days',
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT NULL;

COMMENT ON COLUMN organisations.trial_expires_at IS
  'Timestamp at which a trial org loses Director/agent access if no subscription is active. Set by handle_new_user from billing.trial_duration_days. After this point and while plan=''trial'', the (app)/* middleware redirects to /settings/plan?reason=trial_expired. The column stays populated post-subscription but is not consulted while plan is paid.';

COMMENT ON COLUMN organisations.stripe_price_id IS
  'Active Stripe Price ID (price_*) for the current subscription. Set by the webhook handler on customer.subscription.created/updated. NULL for trial orgs and post-cancellation. Used to render plan-level affordances (current plan badge, change-plan options).';

-- Backfill trial_expires_at for orgs that pre-date this column.
-- billing.trial_duration_days is 30 by seed; if the org was created
-- before that key was seeded the DEFAULT applies (already done by the
-- ALTER above with NOT NULL DEFAULT).
DO $backfill$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT (value)::TEXT::INTEGER INTO v_days
  FROM platform_config
  WHERE key = 'billing.trial_duration_days';

  IF v_days IS NULL THEN
    v_days := 30;
  END IF;

  UPDATE organisations
  SET trial_expires_at = COALESCE(current_period_start, created_at) + (v_days || ' days')::interval
  WHERE plan = 'trial';
END $backfill$;

-- Revise handle_new_user to stamp trial_expires_at from the config key.
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id        UUID;
  user_name         TEXT;
  user_slug         TEXT;
  v_allocation      NUMERIC(20,8);
  v_trial_days      INTEGER;
  v_trial_expires   TIMESTAMPTZ;
BEGIN
  user_name := COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1));
  user_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]+', '-', 'g'));
  user_slug := trim(both '-' from user_slug);
  IF user_slug = '' THEN
    user_slug := 'user';
  END IF;
  IF EXISTS (SELECT 1 FROM organisations WHERE slug = user_slug) THEN
    user_slug := user_slug || '-' || substr(NEW.id::text, 1, 8);
  END IF;

  -- V1.x-C.4 — trial allocation from platform_config.
  SELECT (value)::TEXT::NUMERIC INTO v_allocation
  FROM platform_config
  WHERE key = 'plan.trial_token_allocation_credits';

  -- Phase 9.B — trial duration from platform_config.
  SELECT (value)::TEXT::INTEGER INTO v_trial_days
  FROM platform_config
  WHERE key = 'billing.trial_duration_days';

  IF v_trial_days IS NULL THEN
    v_trial_days := 30;
  END IF;

  v_trial_expires := NOW() + (v_trial_days || ' days')::interval;

  INSERT INTO organisations (name, slug, token_allocation_credits, trial_expires_at)
  VALUES (user_name, user_slug, v_allocation, v_trial_expires)
  RETURNING id INTO new_org_id;

  INSERT INTO organisation_members (organisation_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
