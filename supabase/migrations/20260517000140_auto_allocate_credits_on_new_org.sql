-- V1.x-C.4 — auto-allocation of token_allocation_credits on new org creation.
--
-- Source: stelavox_v1x_c_build_checklist_v1_0.md §2 C.4.
--
-- The M-134 backfill set token_allocation_credits per-row on orgs that
-- existed at migration time. Orgs created AFTER M-134 (via the
-- handle_new_user trigger on new auth signups) would otherwise get
-- NULL allocation — which the V1.x-C.2 gate treats as "not enforced",
-- giving new orgs free unlimited LLM access.
--
-- Fix: replace handle_new_user with a body that ALSO sets
-- token_allocation_credits from plan.<slug>_token_allocation_credits.
-- New orgs default to plan='trial' (organisations.plan DEFAULT 'trial'
-- from M-001), so the trial allocation key is the read.
--
-- The other paths that create orgs (CLI scripts, test fixtures) hit
-- the same trigger so they pick up the same default.
--
-- H-13: SET search_path = public preserved.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_org_id      UUID;
  user_name       TEXT;
  user_slug       TEXT;
  v_allocation    NUMERIC(20,8);
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

  -- V1.x-C.4 — pull the trial allocation from platform_config so the
  -- new org starts with a populated token_allocation_credits column.
  -- Missing key (e.g. pre-V1.x-C.2 DB without the M-134 seed) leaves
  -- it NULL — gate falls through to "not enforced", which matches the
  -- pre-V1.x-C.2 behaviour.
  SELECT (value)::TEXT::NUMERIC INTO v_allocation
  FROM platform_config
  WHERE key = 'plan.trial_token_allocation_credits';

  INSERT INTO organisations (name, slug, token_allocation_credits)
  VALUES (user_name, user_slug, v_allocation)
  RETURNING id INTO new_org_id;

  INSERT INTO organisation_members (organisation_id, user_id, role)
  VALUES (new_org_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
