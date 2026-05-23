-- M-192 — briefs: add `state` column + backfill + triggers.
--
-- Apollo-grade state machine, Phase 0.A.2. The `state` column becomes
-- the source of truth for brief lifecycle; the existing `status` column
-- is retained for now (auto-derived) and dropped in Phase 0.D after all
-- writers are migrated to the new column.
--
-- Source: docs/stelavox_brief_orchestration_phase0_design_v1_0.md §1.briefs.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add the column
-- ---------------------------------------------------------------------------
-- NULL allowed initially to keep the migration backward-compatible during
-- the backfill UPDATE; constraint added in step 3.

ALTER TABLE public.briefs
  ADD COLUMN state TEXT;

COMMENT ON COLUMN public.briefs.state IS
  'Single source of truth for brief lifecycle. State machine: see allowed_transitions WHERE entity_name=''briefs''. Replaces the legacy status column.';

-- ---------------------------------------------------------------------------
-- 2. Backfill
-- ---------------------------------------------------------------------------
-- briefs.status is 1:1 with the new state set (post Q1 cleanup, only
-- 'active'/'completed'/'cancelled' should exist; dead values 'planned'
-- and 'queued' raise an error per backfill verification below).

UPDATE briefs SET state = status;

DO $$
DECLARE
  v_bad INT;
BEGIN
  SELECT COUNT(*) INTO v_bad FROM briefs WHERE state IS NULL OR state NOT IN ('active','completed','cancelled');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'briefs backfill failed: % rows with NULL or out-of-set state. Investigate dead values "planned"/"queued" before proceeding.', v_bad;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. NOT NULL + CHECK constraint
-- ---------------------------------------------------------------------------

ALTER TABLE public.briefs
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT briefs_state_check CHECK (state IN ('active','completed','cancelled'));

-- ---------------------------------------------------------------------------
-- 4. enforce_legal_transition trigger (BEFORE UPDATE OF state)
-- ---------------------------------------------------------------------------
-- This is the Apollo-grade guard: any UPDATE that moves state between
-- two values not in allowed_transitions raises check_violation.

CREATE TRIGGER trg_briefs_enforce_transition
  BEFORE UPDATE OF state ON public.briefs
  FOR EACH ROW
  WHEN (OLD.state IS DISTINCT FROM NEW.state)
  EXECUTE FUNCTION enforce_legal_transition();

-- ---------------------------------------------------------------------------
-- 5. auto_derive_state trigger (BEFORE INSERT OR UPDATE)
-- ---------------------------------------------------------------------------
-- Coexistence bridge: legacy writers update status only. This trigger
-- keeps `state` in sync by deriving it from `status` whenever:
--   * INSERT: NEW.state is NULL but NEW.status is set.
--   * UPDATE: NEW.status changed but NEW.state did not.
--
-- The trigger is dropped in Phase 0.D after all writers move to writing
-- `state` directly. The enforcement trigger above still applies — so
-- if a legacy writer updates status to a value that would produce an
-- illegal state transition, the UPDATE is refused. This catches drift.

CREATE OR REPLACE FUNCTION public.briefs_auto_derive_state()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IS NULL AND NEW.status IS NOT NULL THEN
      NEW.state := NEW.status;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- If status changed but state didn't, derive new state from status.
    -- The 1:1 mapping for briefs makes this trivial.
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.state IS NOT DISTINCT FROM OLD.state THEN
      NEW.state := NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_briefs_auto_derive_state
  BEFORE INSERT OR UPDATE ON public.briefs
  FOR EACH ROW
  EXECUTE FUNCTION briefs_auto_derive_state();

-- The auto-derive trigger fires BEFORE the enforce trigger because
-- PostgreSQL fires BEFORE triggers in alphabetical order on the same
-- table — `trg_briefs_auto_derive_state` < `trg_briefs_enforce_transition`.
-- Verified by Postgres docs (https://www.postgresql.org/docs/current/trigger-definition.html):
-- "If more than one trigger is defined for the same event on the same
-- relation, the triggers will be fired in alphabetical order by trigger name."

-- ---------------------------------------------------------------------------
-- 6. Verification
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_null INT;
  v_legal INT;
BEGIN
  SELECT COUNT(*) INTO v_null FROM briefs WHERE state IS NULL;
  IF v_null > 0 THEN
    RAISE EXCEPTION 'M-192: % briefs rows still have NULL state', v_null;
  END IF;

  -- Confirm allowed_transitions has the briefs entries (defensive).
  SELECT COUNT(*) INTO v_legal FROM allowed_transitions WHERE entity_name = 'briefs';
  IF v_legal < 2 THEN
    RAISE EXCEPTION 'M-192: briefs has only % rows in allowed_transitions; expected ≥ 2', v_legal;
  END IF;
END;
$$;

COMMIT;
